import { ensureDatabase, type CrmDatabase } from "@/db";
import {
  decryptEmailPassword,
  encryptEmailPassword,
  hasEmailCredentialKey,
  SmtpClient,
  bytesToBase64,
  type EmailConnectionSettings,
  type SmtpSecurity,
} from "@/lib/email-server";
import type { EmailLeadSendStat, EmailMessageLog, EmailSettingsPublic, Lead } from "@/lib/crm";
import { loriotEmailContent, stripKnownEmailSignature } from "@/lib/email-branding";
import {
  emailFilesBucket,
  findEmailAssets,
  listEmailAssets,
  MAX_EMAIL_ASSETS,
  MAX_EMAIL_TOTAL_BYTES,
  publicEmailAsset,
} from "@/lib/email-assets";
import { syncAndClassifyReplies } from "@/lib/email-automation";

type Input = Record<string, unknown>;
type EmailSettingsRow = EmailConnectionSettings & {
  id: string;
  passwordCiphertext: string;
  passwordIv: string;
  defaultSubject: string;
  defaultBody: string;
  updatedAt: string;
};

const DEFAULT_SUBJECT = "Giải pháp thiết bị đo Fluke cho {{companyName}}";
const DEFAULT_BODY = `Kính gửi {{salutation}},

Em là Mai Trần Thành, phụ trách sản phẩm Fluke tại Loriot Industrial – Công ty TNHH Công Nghiệp Vàng Anh.

Em được biết {{companyName}} đang hoạt động trong lĩnh vực {{industry}}. Bên em cung cấp các giải pháp đo kiểm Fluke phục vụ bảo trì điện, kiểm tra an toàn, chất lượng điện năng, camera nhiệt và hiệu chuẩn công nghiệp.

Nếu Anh/Chị đang phụ trách kỹ thuật, bảo trì hoặc mua sắm thiết bị đo, em rất mong có cơ hội trao đổi ngắn để tìm hiểu nhu cầu hiện tại của nhà máy.`;

const defaultSettings = (): EmailSettingsPublic => ({
  fromEmail: "hn.sales3@loriot.com.vn",
  fromName: "Mai Trần Thành",
  username: "hn.sales3@loriot.com.vn",
  smtpHost: "pro43.emailserver.vn",
  smtpPort: 465,
  smtpSecurity: "ssl",
  imapHost: "pro43.emailserver.vn",
  imapPort: 993,
  defaultSubject: DEFAULT_SUBJECT,
  defaultBody: DEFAULT_BODY,
  configured: false,
  updatedAt: "",
});

const textValue = (input: Input, key: string, fallback = "") => {
  const value = input[key];
  return typeof value === "string" ? value.trim() : fallback;
};

const numberValue = (input: Input, key: string, fallback: number) => {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
};

const validEmail = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw new Error("Yêu cầu gửi email không đúng nguồn CRM.");
}

async function settingsRow(db: CrmDatabase) {
  return db.prepare(`SELECT id, from_email AS fromEmail, from_name AS fromName, username,
    smtp_host AS smtpHost, smtp_port AS smtpPort, smtp_security AS smtpSecurity,
    imap_host AS imapHost, imap_port AS imapPort, password_ciphertext AS passwordCiphertext,
    password_iv AS passwordIv, default_subject AS defaultSubject, default_body AS defaultBody,
    updated_at AS updatedAt FROM email_settings WHERE id = 'primary'`).first<EmailSettingsRow>();
}

function publicSettings(row: EmailSettingsRow | null): EmailSettingsPublic {
  if (!row) return defaultSettings();
  return {
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    username: row.username,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecurity: row.smtpSecurity,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    defaultSubject: row.defaultSubject || DEFAULT_SUBJECT,
    defaultBody: stripKnownEmailSignature(row.defaultBody || DEFAULT_BODY),
    configured: Boolean(row.passwordCiphertext && row.passwordIv && hasEmailCredentialKey()),
    updatedAt: row.updatedAt,
  };
}

async function loadEmailData(db: CrmDatabase) {
  const [row, messages, leadSendStats, assets] = await Promise.all([
    settingsRow(db),
    db.prepare(`SELECT id, lead_id AS leadId, direction, sender_email AS senderEmail,
      recipient_email AS recipientEmail, subject, body_text AS bodyText, status,
      campaign_id AS campaignId, classification, ai_summary AS aiSummary,
      suggested_action AS suggestedAction, draft_reply AS draftReply,
      ai_confidence AS aiConfidence, ai_source AS aiSource, ai_processed_at AS aiProcessedAt,
      provider_message_id AS providerMessageId, error_message AS errorMessage,
      sent_at AS sentAt, received_at AS receivedAt, created_at AS createdAt
      FROM email_messages ORDER BY created_at DESC LIMIT 120`).all<EmailMessageLog>(),
    db.prepare(`SELECT lead_id AS leadId, COUNT(*) AS sentCount, MAX(sent_at) AS lastSentAt
      FROM email_messages
      WHERE direction = 'outbound' AND status = 'Sent' AND TRIM(lead_id) <> ''
      GROUP BY lead_id`).all<EmailLeadSendStat>(),
    listEmailAssets(db),
  ]);
  return {
    settings: publicSettings(row),
    messages: messages.results ?? [],
    leadSendStats: leadSendStats.results ?? [],
    assets: assets.map(publicEmailAsset),
  };
}

async function requireConnection(db: CrmDatabase) {
  const row = await settingsRow(db);
  if (!row || !row.passwordCiphertext || !row.passwordIv) {
    throw new Error("Vui lòng cấu hình tài khoản email trước khi gửi.");
  }
  const password = await decryptEmailPassword(row.passwordCiphertext, row.passwordIv);
  const settings: EmailConnectionSettings = {
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    username: row.username,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecurity: row.smtpSecurity,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
  };
  return { row, settings, password };
}

async function saveSettings(db: CrmDatabase, input: Input) {
  if (!hasEmailCredentialKey()) throw new Error("Máy chủ CRM chưa có khóa bảo mật email.");
  const current = await settingsRow(db);
  const defaults = defaultSettings();
  const fromEmail = textValue(input, "fromEmail", current?.fromEmail || defaults.fromEmail).toLowerCase();
  const username = textValue(input, "username", current?.username || fromEmail).toLowerCase();
  const smtpHost = textValue(input, "smtpHost", current?.smtpHost || defaults.smtpHost).toLowerCase();
  const imapHost = textValue(input, "imapHost", current?.imapHost || defaults.imapHost).toLowerCase();
  const smtpPort = Math.round(numberValue(input, "smtpPort", current?.smtpPort || defaults.smtpPort));
  const imapPort = Math.round(numberValue(input, "imapPort", current?.imapPort || defaults.imapPort));
  const rawSecurity = textValue(input, "smtpSecurity", current?.smtpSecurity || "ssl");
  const smtpSecurity: SmtpSecurity = rawSecurity === "starttls" ? "starttls" : "ssl";
  if (!validEmail(fromEmail) || !validEmail(username)) throw new Error("Email gửi hoặc tên đăng nhập chưa hợp lệ.");
  if (!smtpHost || !imapHost || smtpPort < 1 || smtpPort > 65_535 || imapPort < 1 || imapPort > 65_535) {
    throw new Error("Thông tin máy chủ email hoặc cổng kết nối chưa hợp lệ.");
  }

  const password = textValue(input, "password");
  let passwordCiphertext = current?.passwordCiphertext || "";
  let passwordIv = current?.passwordIv || "";
  if (password) ({ passwordCiphertext, passwordIv } = await encryptEmailPassword(password));
  if (!passwordCiphertext || !passwordIv) throw new Error("Vui lòng nhập mật khẩu email để kết nối lần đầu.");

  const now = new Date().toISOString();
  const values = [
    fromEmail,
    textValue(input, "fromName", current?.fromName || defaults.fromName),
    username,
    smtpHost,
    smtpPort,
    smtpSecurity,
    imapHost,
    imapPort,
    passwordCiphertext,
    passwordIv,
    textValue(input, "defaultSubject", current?.defaultSubject || DEFAULT_SUBJECT).slice(0, 500),
    textValue(input, "defaultBody", current?.defaultBody || DEFAULT_BODY).slice(0, 12_000),
    now,
  ];
  await db.prepare(`INSERT INTO email_settings (
      id, from_email, from_name, username, smtp_host, smtp_port, smtp_security, imap_host, imap_port,
      password_ciphertext, password_iv, default_subject, default_body, updated_at
    ) VALUES ('primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET from_email = excluded.from_email, from_name = excluded.from_name,
      username = excluded.username, smtp_host = excluded.smtp_host, smtp_port = excluded.smtp_port,
      smtp_security = excluded.smtp_security, imap_host = excluded.imap_host, imap_port = excluded.imap_port,
      password_ciphertext = excluded.password_ciphertext, password_iv = excluded.password_iv,
      default_subject = excluded.default_subject, default_body = excluded.default_body,
      updated_at = excluded.updated_at`).bind(...values).run();
}

const personalize = (template: string, lead: Pick<Lead, "companyName" | "contactName" | "title" | "industry">) => {
  const values: Record<string, string> = {
    companyName: lead.companyName || "Quý Công ty",
    contactName: lead.contactName || "Anh/Chị",
    salutation: lead.contactName || "Quý Anh/Chị",
    title: lead.title || "bộ phận kỹ thuật",
    industry: lead.industry || "sản xuất công nghiệp",
  };
  return template.replace(/\{\{(companyName|contactName|salutation|title|industry)\}\}/g, (_, key: string) => values[key] || "");
};

const followUpDate = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + Math.max(1, Math.min(30, days)));
  return date.toISOString().slice(0, 10);
};

async function sendTest(db: CrmDatabase) {
  const { settings, password } = await requireConnection(db);
  const client = await SmtpClient.open(settings, password);
  try {
    return await client.send({
      to: settings.fromEmail,
      recipientName: settings.fromName,
      subject: "Kiểm tra kết nối Loriot CRM",
      ...loriotEmailContent("Email này xác nhận Loriot CRM đã kết nối thành công với máy chủ gửi thư của anh."),
    });
  } finally {
    await client.close();
  }
}

async function sendLeadEmails(db: CrmDatabase, input: Input) {
  const leadIds = Array.isArray(input.leadIds)
    ? input.leadIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const uniqueIds = [...new Set(leadIds)].slice(0, 10);
  if (!uniqueIds.length) throw new Error("Vui lòng chọn ít nhất một Lead có email.");
  if (leadIds.length > 10) throw new Error("Mỗi lần chỉ gửi tối đa 10 Lead để bảo vệ uy tín email công ty.");
  const assetIds = Array.isArray(input.assetIds)
    ? input.assetIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length > MAX_EMAIL_ASSETS) throw new Error(`Mỗi email chỉ được chọn tối đa ${MAX_EMAIL_ASSETS} tệp hoặc hình ảnh.`);
  const subjectTemplate = textValue(input, "subject").slice(0, 500);
  const bodyTemplate = textValue(input, "body").slice(0, 12_000);
  if (!subjectTemplate || !bodyTemplate) throw new Error("Vui lòng nhập tiêu đề và nội dung email.");
  const placeholders = uniqueIds.map(() => "?").join(",");
  const result = await db.prepare(`SELECT id, company_name AS companyName, contact_name AS contactName,
    title, industry, email, status FROM prospecting_leads WHERE id IN (${placeholders}) ORDER BY updated_at DESC`)
    .bind(...uniqueIds).all<Pick<Lead, "id" | "companyName" | "contactName" | "title" | "industry" | "email" | "status">>();
  const leads = result.results ?? [];
  const invalid = leads.filter((lead) => !validEmail(lead.email));
  if (invalid.length) throw new Error(`Có ${invalid.length} Lead chưa có địa chỉ email hợp lệ.`);
  if (leads.length !== uniqueIds.length) throw new Error("Một số Lead đã bị xóa hoặc không còn tồn tại.");

  const assetRows = await findEmailAssets(db, uniqueAssetIds);
  if (assetRows.length !== uniqueAssetIds.length) throw new Error("Một số tệp đã bị xóa khỏi kho email.");
  const totalAssetBytes = assetRows.reduce((sum, asset) => sum + asset.sizeBytes, 0);
  if (totalAssetBytes > MAX_EMAIL_TOTAL_BYTES) throw new Error("Tổng dung lượng tệp gửi kèm vượt quá 15 MB.");
  const storedAssets = await Promise.all(assetRows.map(async (asset) => {
    const object = await emailFilesBucket().get(asset.objectKey);
    if (!object) throw new Error(`Không tìm thấy tệp ${asset.fileName} trong kho lưu trữ.`);
    return { ...asset, contentBase64: bytesToBase64(new Uint8Array(await object.arrayBuffer())) };
  }));
  const contentImages = storedAssets.filter((asset) => asset.fileKind === "image").map((asset) => ({
    contentId: `email-asset-${asset.id.toLowerCase()}`,
    filename: asset.fileName,
    contentType: asset.contentType,
    contentBase64: asset.contentBase64,
  }));
  const attachments = storedAssets.filter((asset) => asset.fileKind !== "image").map((asset) => ({
    filename: asset.fileName,
    contentType: asset.contentType,
    contentBase64: asset.contentBase64,
  }));

  const { settings, password } = await requireConnection(db);
  const client = await SmtpClient.open(settings, password);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const due = followUpDate(Math.round(numberValue(input, "followUpDays", 4)));
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  try {
    for (const lead of leads) {
      const id = `EML-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const subject = personalize(subjectTemplate, lead);
      const body = personalize(bodyTemplate, lead);
      const branded = loriotEmailContent(body, contentImages);
      try {
        const messageId = await client.send({
          to: lead.email,
          recipientName: lead.contactName || lead.companyName,
          subject,
          ...branded,
          attachments,
        });
        await db.batch([
          db.prepare(`INSERT INTO email_messages (
            id, lead_id, direction, sender_email, recipient_email, subject, body_text, status,
            provider_message_id, error_message, sent_at, received_at, created_at
          ) VALUES (?, ?, 'outbound', ?, ?, ?, ?, 'Sent', ?, '', ?, '', ?)`)
            .bind(id, lead.id, settings.fromEmail, lead.email, subject, branded.text, messageId, now, now),
          db.prepare(`UPDATE prospecting_leads SET last_email_date = ?, email_subject = ?,
            status = CASE WHEN converted_opportunity_id <> '' THEN status ELSE 'Chờ phản hồi' END,
            next_follow_up_date = CASE WHEN converted_opportunity_id <> '' THEN next_follow_up_date ELSE ? END,
            updated_at = ? WHERE id = ?`).bind(today, subject, due, now, lead.id),
        ]);
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Không gửi được email.";
        await db.prepare(`INSERT INTO email_messages (
          id, lead_id, direction, sender_email, recipient_email, subject, body_text, status,
          provider_message_id, error_message, sent_at, received_at, created_at
        ) VALUES (?, ?, 'outbound', ?, ?, ?, ?, 'Failed', ?, ?, '', '', ?)`)
          .bind(id, lead.id, settings.fromEmail, lead.email, subject, body, `failed:${id}`, message.slice(0, 1_000), now).run();
        errors.push(`${lead.companyName}: ${message}`);
        failed += 1;
      }
    }
  } finally {
    await client.close();
  }
  return { sent, failed, errors: errors.slice(0, 5) };
}

export async function GET() {
  try {
    const db = await ensureDatabase();
    return Response.json(await loadEmailData(db));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể tải dữ liệu email.";
    console.error(JSON.stringify({ message: "email data load failed", error: message }));
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dữ liệu email không hợp lệ.");
    const input = value as Input;
    const action = textValue(input, "action");
    const db = await ensureDatabase();
    let result: Record<string, unknown> = {};
    if (action === "saveSettings") await saveSettings(db, input);
    else if (action === "testConnection") result = { messageId: await sendTest(db) };
    else if (action === "sendLeads") result = await sendLeadEmails(db, input);
    else if (action === "syncReplies") result = await syncAndClassifyReplies(db);
    else throw new Error("Thao tác email không hợp lệ.");
    return Response.json({ ...await loadEmailData(db), result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể xử lý email.";
    console.error(JSON.stringify({ message: "email operation failed", error: message }));
    return Response.json({ error: message }, { status: 400 });
  }
}
