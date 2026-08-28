import { env } from "cloudflare:workers";
import type { CrmDatabase } from "@/db";
import {
  bytesToBase64,
  decryptEmailPassword,
  hasEmailCredentialKey,
  ImapClient,
  SmtpClient,
  type EmailConnectionSettings,
} from "@/lib/email-server";
import { loriotEmailContent } from "@/lib/email-branding";
import {
  INDUSTRY_EMAIL_TEMPLATES,
  industryTemplateById,
  type EmailSequenceStep,
} from "@/lib/industry-email-templates";
import {
  emailFilesBucket,
  findEmailAssets,
  MAX_EMAIL_ASSETS,
  MAX_EMAIL_TOTAL_BYTES,
} from "@/lib/email-assets";
import type {
  EmailAutomationAnalytics,
  EmailAutomationSettings,
  EmailCampaign,
  EmailReplyClassification,
  Lead,
} from "@/lib/crm";

type Input = Record<string, unknown>;

type AiBinding = {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
};

const workersAi = () => env.AI as AiBinding;

type EmailSettingsRow = EmailConnectionSettings & {
  passwordCiphertext: string;
  passwordIv: string;
};

type AutomationSettingsRow = {
  enabled: number;
  dailyLimit: number;
  batchSize: number;
  sendStartHour: number;
  sendEndHour: number;
  weekdaysOnly: number;
  autoClassifyReplies: number;
  updatedAt: string;
};

type CampaignRow = {
  id: string;
  name: string;
  objective: string;
  status: EmailCampaign["status"];
  startDate: string;
  subjectTemplate: string;
  bodyTemplate: string;
  followUpEnabled: number;
  followUpDelayDays: number;
  followUpSubjectTemplate: string;
  followUpBodyTemplate: string;
  industryTemplateId: string;
  industryGroup: string;
  sequenceJson: string;
  assetIdsJson: string;
  totalRecipients: number;
  queuedRecipients: number;
  sentRecipients: number;
  repliedRecipients: number;
  completedRecipients: number;
  failedRecipients: number;
  createdAt: string;
  updatedAt: string;
};

type QueuedRecipient = {
  id: string;
  campaignId: string;
  leadId: string;
  currentStep: number;
  attempts: number;
  campaignName: string;
  subjectTemplate: string;
  bodyTemplate: string;
  followUpEnabled: number;
  followUpDelayDays: number;
  followUpSubjectTemplate: string;
  followUpBodyTemplate: string;
  sequenceJson: string;
  assetIdsJson: string;
  companyName: string;
  contactName: string;
  title: string;
  industry: string;
  notes: string;
  email: string;
};

type ReplyAnalysis = {
  classification: EmailReplyClassification;
  confidence: number;
  summary: string;
  suggestedAction: string;
  draftReply: string;
  optOut: boolean;
  source: "AI" | "Rules";
};

const AI_MODEL = "@cf/google/gemma-3-12b-it";
const CLASSIFICATIONS: EmailReplyClassification[] = [
  "Có nhu cầu",
  "Yêu cầu báo giá",
  "Hẹn liên hệ lại",
  "Sai người liên hệ",
  "Không quan tâm",
  "Từ chối nhận email",
  "Khác",
];

const textValue = (input: Input, key: string, fallback = "") => {
  const value = input[key];
  return typeof value === "string" ? value.trim() : fallback;
};

const numberValue = (input: Input, key: string, fallback: number) => {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
};

const booleanValue = (input: Input, key: string, fallback = false) => {
  const value = input[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  return fallback;
};

const validEmail = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

const clampInt = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Math.round(value)));

const safeJsonArray = (value: string) => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const validSequenceStep = (value: unknown): value is EmailSequenceStep => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const step = value as Record<string, unknown>;
  return Number.isFinite(Number(step.order))
    && typeof step.label === "string"
    && Number.isFinite(Number(step.delayDays))
    && typeof step.subjectTemplate === "string"
    && typeof step.bodyTemplate === "string";
};

const safeSequence = (value: unknown): EmailSequenceStep[] => {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(validSequenceStep).slice(0, 4).map((step, index) => ({
    order: index + 1,
    label: String(step.label).slice(0, 120),
    delayDays: index === 0 ? 0 : clampInt(Number(step.delayDays), 1, 30),
    subjectTemplate: String(step.subjectTemplate).trim().slice(0, 500),
    bodyTemplate: String(step.bodyTemplate).trim().slice(0, 12_000),
  })).filter((step) => step.subjectTemplate && step.bodyTemplate);
};

const legacySequence = (recipient: QueuedRecipient): EmailSequenceStep[] => safeSequence([
  {
    order: 1,
    label: "Tiếp cận ban đầu",
    delayDays: 0,
    subjectTemplate: recipient.subjectTemplate,
    bodyTemplate: recipient.bodyTemplate,
  },
  ...(recipient.followUpEnabled ? [{
    order: 2,
    label: "Follow-up",
    delayDays: recipient.followUpDelayDays,
    subjectTemplate: recipient.followUpSubjectTemplate,
    bodyTemplate: recipient.followUpBodyTemplate,
  }] : []),
]);

const vietnamNow = (date = new Date()) => {
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1_000);
  return {
    date: local.toISOString().slice(0, 10),
    hour: local.getUTCHours(),
    weekday: local.getUTCDay(),
  };
};

const nextVietnamMorning = (dateValue: string) => {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : vietnamNow().date;
  return new Date(`${safeDate}T01:00:00.000Z`).toISOString();
};

const addDays = (value: string, days: number) => {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + clampInt(days, 1, 30));
  return date.toISOString();
};

const tomorrow = () => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

export const personalizeEmail = (
  template: string,
  lead: Pick<Lead, "companyName" | "contactName" | "title" | "industry" | "notes">,
) => {
  const noteValue = (label: string) => lead.notes
    .split("\n")
    .find((line) => line.trim().toLowerCase().startsWith(`${label.toLowerCase()}:`))
    ?.split(":").slice(1).join(":").trim() || "";
  const values: Record<string, string> = {
    companyName: lead.companyName || "Quý Công ty",
    contactName: lead.contactName || "Anh/Chị",
    salutation: lead.contactName || "Quý Anh/Chị",
    title: lead.title || "bộ phận kỹ thuật",
    industry: lead.industry || "sản xuất công nghiệp",
    plantSite: noteValue("Nhà máy/Site") || lead.companyName || "nhà máy",
    targetDepartment: noteValue("Bộ phận cần tiếp cận") || lead.title || "bộ phận kỹ thuật/bảo trì",
    recommendedSolution: noteValue("Giải pháp Fluke đề xuất") || "Thiết bị kiểm tra điện, camera nhiệt và giải pháp bảo trì Fluke phù hợp với ứng dụng thực tế.",
  };
  return template.replace(/\{\{(companyName|contactName|salutation|title|industry|plantSite|targetDepartment|recommendedSolution)\}\}/g, (_, key: string) => values[key] || "");
};

async function connectionSettings(db: CrmDatabase, credentialKeyOverride?: string) {
  const row = await db.prepare(`SELECT from_email AS fromEmail, from_name AS fromName, username,
      smtp_host AS smtpHost, smtp_port AS smtpPort, smtp_security AS smtpSecurity,
      imap_host AS imapHost, imap_port AS imapPort, password_ciphertext AS passwordCiphertext,
      password_iv AS passwordIv FROM email_settings WHERE id = 'primary'`).first<EmailSettingsRow>();
  if (!row || !row.passwordCiphertext || !row.passwordIv || !hasEmailCredentialKey(credentialKeyOverride)) {
    throw new Error("Vui lòng cấu hình tài khoản email trước khi bật tự động hóa.");
  }
  return { settings: row, password: await decryptEmailPassword(row.passwordCiphertext, row.passwordIv, credentialKeyOverride) };
}

export async function getAutomationSettings(db: CrmDatabase): Promise<EmailAutomationSettings> {
  const row = await db.prepare(`SELECT enabled, daily_limit AS dailyLimit, batch_size AS batchSize,
      send_start_hour AS sendStartHour, send_end_hour AS sendEndHour, weekdays_only AS weekdaysOnly,
      auto_classify_replies AS autoClassifyReplies, updated_at AS updatedAt
      FROM email_automation_settings WHERE id = 'primary'`).first<AutomationSettingsRow>();
  return {
    enabled: Boolean(row?.enabled),
    dailyLimit: row?.dailyLimit ?? 20,
    batchSize: row?.batchSize ?? 2,
    sendStartHour: row?.sendStartHour ?? 8,
    sendEndHour: row?.sendEndHour ?? 17,
    weekdaysOnly: row ? Boolean(row.weekdaysOnly) : true,
    autoClassifyReplies: row ? Boolean(row.autoClassifyReplies) : true,
    updatedAt: row?.updatedAt || "",
  };
}

export async function saveAutomationSettings(db: CrmDatabase, input: Input) {
  const enabled = booleanValue(input, "enabled");
  if (enabled) await connectionSettings(db);
  const dailyLimit = clampInt(numberValue(input, "dailyLimit", 20), 20, 50);
  const batchSize = clampInt(numberValue(input, "batchSize", 2), 1, 5);
  const sendStartHour = clampInt(numberValue(input, "sendStartHour", 8), 0, 22);
  const sendEndHour = clampInt(numberValue(input, "sendEndHour", 17), sendStartHour + 1, 23);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO email_automation_settings (
      id, enabled, daily_limit, batch_size, send_start_hour, send_end_hour,
      weekdays_only, auto_classify_replies, updated_at
    ) VALUES ('primary', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, daily_limit = excluded.daily_limit,
      batch_size = excluded.batch_size, send_start_hour = excluded.send_start_hour,
      send_end_hour = excluded.send_end_hour, weekdays_only = excluded.weekdays_only,
      auto_classify_replies = excluded.auto_classify_replies, updated_at = excluded.updated_at`)
    .bind(
      enabled ? 1 : 0,
      dailyLimit,
      batchSize,
      sendStartHour,
      sendEndHour,
      booleanValue(input, "weekdaysOnly", true) ? 1 : 0,
      booleanValue(input, "autoClassifyReplies", true) ? 1 : 0,
      now,
    ).run();
}

const campaignSelect = `SELECT c.id, c.name, c.objective, c.status, c.start_date AS startDate,
  c.subject_template AS subjectTemplate, c.body_template AS bodyTemplate,
  c.follow_up_enabled AS followUpEnabled, c.follow_up_delay_days AS followUpDelayDays,
  c.follow_up_subject_template AS followUpSubjectTemplate,
  c.follow_up_body_template AS followUpBodyTemplate,
  c.industry_template_id AS industryTemplateId, c.industry_group AS industryGroup,
  c.sequence_json AS sequenceJson, c.asset_ids_json AS assetIdsJson,
  COUNT(r.id) AS totalRecipients,
  SUM(CASE WHEN r.status IN ('Queued','Awaiting') THEN 1 ELSE 0 END) AS queuedRecipients,
  SUM(CASE WHEN r.sent_at <> '' THEN 1 ELSE 0 END) AS sentRecipients,
  SUM(CASE WHEN r.status = 'Replied' THEN 1 ELSE 0 END) AS repliedRecipients,
  SUM(CASE WHEN r.status = 'Completed' THEN 1 ELSE 0 END) AS completedRecipients,
  SUM(CASE WHEN r.status = 'Failed' THEN 1 ELSE 0 END) AS failedRecipients,
  c.created_at AS createdAt, c.updated_at AS updatedAt
  FROM email_campaigns c LEFT JOIN email_campaign_recipients r ON r.campaign_id = c.id
  GROUP BY c.id ORDER BY c.created_at DESC`;

export async function listCampaigns(db: CrmDatabase): Promise<EmailCampaign[]> {
  const result = await db.prepare(campaignSelect).all<CampaignRow>();
  return (result.results ?? []).map((row) => ({
    ...row,
    followUpEnabled: Boolean(row.followUpEnabled),
    sequenceSteps: safeSequence(row.sequenceJson),
    assetIds: safeJsonArray(row.assetIdsJson),
    totalRecipients: Number(row.totalRecipients || 0),
    queuedRecipients: Number(row.queuedRecipients || 0),
    sentRecipients: Number(row.sentRecipients || 0),
    repliedRecipients: Number(row.repliedRecipients || 0),
    completedRecipients: Number(row.completedRecipients || 0),
    failedRecipients: Number(row.failedRecipients || 0),
  }));
}

export async function saveCampaign(db: CrmDatabase, input: Input) {
  const name = textValue(input, "name").slice(0, 180);
  const objective = textValue(input, "objective").slice(0, 1_000);
  const startDate = textValue(input, "startDate", vietnamNow().date);
  const industryTemplateId = textValue(input, "industryTemplateId").slice(0, 80);
  const selectedTemplate = industryTemplateId ? industryTemplateById(industryTemplateId) : undefined;
  if (industryTemplateId && !selectedTemplate) throw new Error("Không tìm thấy bộ mẫu email theo ngành đã chọn.");
  let sequenceSteps = safeSequence(input.sequenceSteps);
  if (selectedTemplate && sequenceSteps.length !== 4) sequenceSteps = selectedTemplate.steps;
  if (!sequenceSteps.length) {
    const subjectTemplate = textValue(input, "subjectTemplate").slice(0, 500);
    const bodyTemplate = textValue(input, "bodyTemplate").slice(0, 12_000);
    const followUpEnabled = booleanValue(input, "followUpEnabled");
    sequenceSteps = safeSequence([
      { order: 1, label: "Tiếp cận ban đầu", delayDays: 0, subjectTemplate, bodyTemplate },
      ...(followUpEnabled ? [{
        order: 2,
        label: "Follow-up",
        delayDays: clampInt(numberValue(input, "followUpDelayDays", 4), 1, 30),
        subjectTemplate: textValue(input, "followUpSubjectTemplate").slice(0, 500),
        bodyTemplate: textValue(input, "followUpBodyTemplate").slice(0, 12_000),
      }] : []),
    ]);
  }
  const subjectTemplate = sequenceSteps[0]?.subjectTemplate || "";
  const bodyTemplate = sequenceSteps[0]?.bodyTemplate || "";
  const followUpEnabled = sequenceSteps.length > 1;
  const followUpDelayDays = sequenceSteps[1]?.delayDays || 4;
  const followUpSubjectTemplate = sequenceSteps[1]?.subjectTemplate || "";
  const followUpBodyTemplate = sequenceSteps[1]?.bodyTemplate || "";
  const industryGroup = (selectedTemplate?.groupName || textValue(input, "industryGroup")).slice(0, 120);
  if (!name || !objective || !subjectTemplate || !bodyTemplate) {
    throw new Error("Vui lòng nhập tên, mục tiêu, tiêu đề và nội dung chiến dịch.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Ngày bắt đầu chiến dịch chưa hợp lệ.");
  if (selectedTemplate && sequenceSteps.length !== 4) throw new Error("Bộ mẫu theo ngành phải có đủ 4 email.");

  const leadIds = Array.isArray(input.leadIds)
    ? [...new Set(input.leadIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0))].slice(0, 300)
    : [];
  if (!leadIds.length) throw new Error("Vui lòng chọn ít nhất một Lead cho chiến dịch.");
  const placeholders = leadIds.map(() => "?").join(",");
  const leads = await db.prepare(`SELECT id, email, email_opt_out AS emailOptOut, status
      FROM prospecting_leads WHERE id IN (${placeholders})`).bind(...leadIds)
    .all<Pick<Lead, "id" | "email" | "status"> & { emailOptOut: number }>();
  const eligible = (leads.results ?? []).filter((lead) => validEmail(lead.email)
    && !lead.emailOptOut && lead.status !== "Không nhận email" && lead.status !== "Đã chuyển cơ hội");
  if (eligible.length !== leadIds.length) {
    throw new Error("Danh sách có Lead thiếu email, đã từ chối nhận email hoặc đã chuyển thành cơ hội.");
  }

  const assetIds = Array.isArray(input.assetIds)
    ? [...new Set(input.assetIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0))]
    : [];
  if (assetIds.length > MAX_EMAIL_ASSETS) throw new Error(`Chỉ được chọn tối đa ${MAX_EMAIL_ASSETS} tệp cho chiến dịch.`);
  const assets = await findEmailAssets(db, assetIds);
  if (assets.length !== assetIds.length) throw new Error("Một số tệp chiến dịch không còn tồn tại.");
  if (assets.reduce((sum, asset) => sum + asset.sizeBytes, 0) > MAX_EMAIL_TOTAL_BYTES) {
    throw new Error("Tổng dung lượng tệp chiến dịch vượt quá 15 MB.");
  }

  const id = `CMP-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
  const now = new Date().toISOString();
  const statements = [db.prepare(`INSERT INTO email_campaigns (
      id, name, objective, status, start_date, subject_template, body_template,
      follow_up_enabled, follow_up_delay_days, follow_up_subject_template,
      follow_up_body_template, industry_template_id, industry_group, sequence_json,
      asset_ids_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'Draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id, name, objective, startDate, subjectTemplate, bodyTemplate, followUpEnabled ? 1 : 0,
      followUpDelayDays, followUpSubjectTemplate, followUpBodyTemplate, industryTemplateId,
      industryGroup, JSON.stringify(sequenceSteps), JSON.stringify(assetIds), now, now,
    )];
  const nextSendAt = nextVietnamMorning(startDate);
  for (const leadId of leadIds) {
    statements.push(db.prepare(`INSERT INTO email_campaign_recipients (
        id, campaign_id, lead_id, status, current_step, next_send_at, sent_at, replied_at,
        attempts, last_error, email_message_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'Queued', 0, ?, '', '', 0, '', '', ?, ?)`)
      .bind(`CPR-${crypto.randomUUID().slice(0, 12).toUpperCase()}`, id, leadId, nextSendAt, now, now));
  }
  await db.batch(statements);
  return { id };
}

export async function setCampaignStatus(db: CrmDatabase, input: Input) {
  const id = textValue(input, "id");
  const status = textValue(input, "status");
  if (!id || !["Active", "Paused"].includes(status)) throw new Error("Trạng thái chiến dịch không hợp lệ.");
  const campaign = await db.prepare("SELECT id, status FROM email_campaigns WHERE id = ?")
    .bind(id).first<{ id: string; status: string }>();
  if (!campaign) throw new Error("Không tìm thấy chiến dịch.");
  if (status === "Active") {
    const settings = await getAutomationSettings(db);
    if (!settings.enabled) throw new Error("Hãy bật công tắc tự động hóa trước khi kích hoạt chiến dịch.");
    await connectionSettings(db);
    const queued = await db.prepare(`SELECT COUNT(*) AS count FROM email_campaign_recipients
      WHERE campaign_id = ? AND status IN ('Queued','Awaiting')`).bind(id).first<{ count: number }>();
    if (!(queued?.count ?? 0)) throw new Error("Chiến dịch không còn Lead đang chờ gửi.");
  }
  await db.prepare("UPDATE email_campaigns SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, new Date().toISOString(), id).run();
}

export async function deleteCampaign(db: CrmDatabase, input: Input) {
  const id = textValue(input, "id");
  if (!id) throw new Error("Thiếu mã chiến dịch.");
  const campaign = await db.prepare("SELECT status FROM email_campaigns WHERE id = ?")
    .bind(id).first<{ status: string }>();
  if (!campaign) throw new Error("Không tìm thấy chiến dịch.");
  if (campaign.status === "Active") throw new Error("Hãy tạm dừng chiến dịch trước khi xóa.");
  await db.batch([
    db.prepare("DELETE FROM email_campaign_recipients WHERE campaign_id = ?").bind(id),
    db.prepare("DELETE FROM email_campaigns WHERE id = ?").bind(id),
  ]);
}

function responseText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return typeof record.response === "string" ? record.response : "";
}

function parsedAiObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.classification === "string" || typeof record.subject === "string") return record;
    const text = responseText(value);
    if (text) {
      try {
        const parsed: unknown = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function draftCampaignWithAi(input: Input) {
  const objective = textValue(input, "objective").slice(0, 1_000);
  const industry = textValue(input, "industry", "nhà máy sản xuất công nghiệp").slice(0, 300);
  if (!objective) throw new Error("Vui lòng mô tả mục tiêu chiến dịch để AI soạn nội dung.");
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
      followUpSubject: { type: "string" },
      followUpBody: { type: "string" },
    },
    required: ["name", "subject", "body", "followUpSubject", "followUpBody"],
  };
  const prompt = `Bạn là trợ lý sales B2B thiết bị đo Fluke của Loriot Industrial tại Việt Nam.
Soạn chiến dịch email tiếng Việt, lịch sự, ngắn gọn, không phóng đại và không tự bịa thông số kỹ thuật.
Mục tiêu: ${objective}
Ngành khách hàng: ${industry}
Dùng đúng các biến khi phù hợp: {{companyName}}, {{contactName}}, {{salutation}}, {{title}}, {{industry}}.
Email đầu tiên cần giới thiệu giá trị và xin một cuộc trao đổi ngắn. Email follow-up cần nhẹ nhàng, không gây áp lực.`;
  try {
    const result: unknown = await workersAi().run(AI_MODEL, { prompt, guided_json: schema });
    const parsed = parsedAiObject(result);
    if (parsed) return {
      name: String(parsed.name || "Chiến dịch Fluke").slice(0, 180),
      subject: String(parsed.subject || "Giải pháp Fluke cho {{companyName}}").slice(0, 500),
      body: String(parsed.body || "").slice(0, 12_000),
      followUpSubject: String(parsed.followUpSubject || "Re: Giải pháp Fluke cho {{companyName}}").slice(0, 500),
      followUpBody: String(parsed.followUpBody || "").slice(0, 12_000),
    };
  } catch (error) {
    console.error(JSON.stringify({ message: "campaign AI draft failed", error: error instanceof Error ? error.message : String(error) }));
  }
  return {
    name: `Chiến dịch Fluke – ${industry}`,
    subject: "Giải pháp thiết bị đo Fluke cho {{companyName}}",
    body: `Kính gửi {{salutation}},\n\nEm là Mai Trần Thành, phụ trách sản phẩm Fluke tại Loriot Industrial. Em mong muốn trao đổi với {{companyName}} về ${objective}.\n\nNếu Anh/Chị đang phụ trách kỹ thuật, bảo trì hoặc mua sắm, em rất mong có cơ hội trao đổi ngắn để tìm hiểu nhu cầu thực tế.`,
    followUpSubject: "Re: Giải pháp thiết bị đo Fluke cho {{companyName}}",
    followUpBody: `Kính gửi {{salutation}},\n\nEm xin phép nhắc lại email trước về ${objective}. Nếu nội dung này phù hợp, em sẵn sàng trao đổi ngắn và đề xuất giải pháp theo nhu cầu thực tế của {{companyName}}.`,
  };
}

const fallbackReplyAnalysis = (subject: string, body: string, lead: Pick<Lead, "companyName" | "contactName">): ReplyAnalysis => {
  const value = `${subject}\n${body}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  let classification: EmailReplyClassification = "Khác";
  let action = "Đọc phản hồi và liên hệ lại trong ngày làm việc tiếp theo.";
  let optOut = false;
  if (/bao gia|quotation|quote|gia san pham|price/.test(value)) {
    classification = "Yêu cầu báo giá";
    action = "Xác nhận model, số lượng, End-User và thời hạn cần hàng trước khi báo giá.";
  } else if (/khong nhan|dung gui|unsubscribe|remove me/.test(value)) {
    classification = "Từ chối nhận email";
    action = "Dừng toàn bộ email tự động và không liên hệ lại qua email.";
    optOut = true;
  } else if (/khong quan tam|no interest|not interested/.test(value)) {
    classification = "Không quan tâm";
    action = "Dừng chiến dịch và lưu lý do để tránh làm phiền khách hàng.";
  } else if (/lien he lai|thang sau|tuan sau|later|next month|next week/.test(value)) {
    classification = "Hẹn liên hệ lại";
    action = "Đặt lịch Follow-up theo thời điểm khách hàng đề nghị.";
  } else if (/khong phu trach|sai nguoi|contact .* instead|wrong person/.test(value)) {
    classification = "Sai người liên hệ";
    action = "Xin thông tin người phụ trách kỹ thuật hoặc mua hàng phù hợp.";
  } else if (/quan tam|tu van|trao doi|nhu cau|interested/.test(value)) {
    classification = "Có nhu cầu";
    action = "Liên hệ trong ngày để xác nhận ứng dụng, người dùng và thời gian mua.";
  }
  const salutation = lead.contactName || "Anh/Chị";
  return {
    classification,
    confidence: classification === "Khác" ? 0.45 : 0.76,
    summary: subject || "Khách hàng đã phản hồi email.",
    suggestedAction: action,
    draftReply: optOut ? "" : `Kính gửi ${salutation},\n\nEm cảm ơn Anh/Chị đã phản hồi. Em đã ghi nhận thông tin và sẽ hỗ trợ theo nội dung Anh/Chị trao đổi.\n\nTrân trọng,`,
    optOut,
    source: "Rules",
  };
};

async function analyzeReply(
  subject: string,
  body: string,
  lead: Pick<Lead, "companyName" | "contactName">,
  useAi: boolean,
): Promise<ReplyAnalysis> {
  const fallback = fallbackReplyAnalysis(subject, body, lead);
  if (!useAi) return fallback;
  const schema = {
    type: "object",
    properties: {
      classification: { type: "string", enum: CLASSIFICATIONS },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      summary: { type: "string" },
      suggestedAction: { type: "string" },
      draftReply: { type: "string" },
      optOut: { type: "boolean" },
    },
    required: ["classification", "confidence", "summary", "suggestedAction", "draftReply", "optOut"],
  };
  const prompt = `Phân loại phản hồi email B2B bằng tiếng Việt cho sales Fluke.
Chỉ dựa trên nội dung có thật, không suy diễn nhu cầu hay giá.
Công ty: ${lead.companyName}
Người liên hệ: ${lead.contactName || "Chưa rõ"}
Tiêu đề: ${subject}
Nội dung: ${body || "Không đọc được nội dung; hãy phân loại thận trọng theo tiêu đề."}
Viết tóm tắt và hành động đề xuất thật ngắn. Bản nháp trả lời lịch sự, không cam kết giá hay thời gian giao hàng. Nếu khách yêu cầu ngừng nhận email, optOut phải là true và draftReply để trống.`;
  try {
    const result: unknown = await workersAi().run(AI_MODEL, { prompt, guided_json: schema });
    const parsed = parsedAiObject(result);
    const classification = String(parsed?.classification || "") as EmailReplyClassification;
    if (parsed && CLASSIFICATIONS.includes(classification)) {
      return {
        classification,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0))),
        summary: String(parsed.summary || fallback.summary).slice(0, 1_000),
        suggestedAction: String(parsed.suggestedAction || fallback.suggestedAction).slice(0, 1_000),
        draftReply: String(parsed.draftReply || "").slice(0, 8_000),
        optOut: Boolean(parsed.optOut) || classification === "Từ chối nhận email",
        source: "AI",
      };
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "reply AI classification failed", error: error instanceof Error ? error.message : String(error) }));
  }
  return fallback;
}

export async function syncAndClassifyReplies(db: CrmDatabase, credentialKeyOverride?: string) {
  const automation = await getAutomationSettings(db);
  const { settings, password } = await connectionSettings(db, credentialKeyOverride);
  const client = await ImapClient.open(settings, password);
  let messages;
  try {
    messages = await client.recentHeaders(30, 80);
  } finally {
    await client.close();
  }
  const leadResult = await db.prepare(`SELECT id, email, company_name AS companyName,
      contact_name AS contactName, converted_opportunity_id AS convertedOpportunityId
      FROM prospecting_leads WHERE TRIM(email) <> '' ORDER BY updated_at DESC`)
    .all<Pick<Lead, "id" | "email" | "companyName" | "contactName" | "convertedOpportunityId">>();
  const leadByEmail = new Map<string, Pick<Lead, "id" | "email" | "companyName" | "contactName" | "convertedOpportunityId">>();
  for (const lead of leadResult.results ?? []) {
    const key = lead.email.trim().toLowerCase();
    if (key && !leadByEmail.has(key)) leadByEmail.set(key, lead);
  }
  let matched = 0;
  let added = 0;
  for (const message of messages) {
    const lead = leadByEmail.get(message.fromEmail);
    if (!lead) continue;
    matched += 1;
    const existing = await db.prepare("SELECT id FROM email_messages WHERE provider_message_id = ?")
      .bind(message.messageId).first<{ id: string }>();
    if (existing) continue;
    const analysis = await analyzeReply(message.subject, message.bodyText, lead, automation.autoClassifyReplies);
    const id = `EML-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const now = new Date().toISOString();
    const activeRecipient = await db.prepare(`SELECT id, campaign_id AS campaignId FROM email_campaign_recipients
      WHERE lead_id = ? AND sent_at <> '' AND sent_at <= ?
      AND status IN ('Queued','Awaiting','Completed') ORDER BY updated_at DESC LIMIT 1`)
      .bind(lead.id, message.receivedAt).first<{ id: string; campaignId: string }>();
    const leadStatus = lead.convertedOpportunityId
      ? "Đã chuyển cơ hội"
      : analysis.optOut ? "Không nhận email"
        : analysis.classification === "Không quan tâm" ? "Không quan tâm" : "Có phản hồi";
    const statements = [
      db.prepare(`INSERT INTO email_messages (
        id, lead_id, direction, sender_email, recipient_email, subject, body_text, status,
        campaign_id, classification, ai_summary, suggested_action, draft_reply,
        ai_confidence, ai_source, ai_processed_at, provider_message_id, error_message,
        sent_at, received_at, created_at
      ) VALUES (?, ?, 'inbound', ?, ?, ?, ?, 'Received', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)`)
        .bind(
          id, lead.id, message.fromEmail, settings.fromEmail, message.subject, message.bodyText,
          activeRecipient?.campaignId || "", analysis.classification, analysis.summary,
          analysis.suggestedAction, analysis.draftReply, analysis.confidence, analysis.source,
          now, message.messageId, message.receivedAt, now,
        ),
      db.prepare(`UPDATE prospecting_leads SET status = ?, email_opt_out = CASE WHEN ? = 1 THEN 1 ELSE email_opt_out END,
        reply_notes = ?, next_follow_up_date = ?, updated_at = ? WHERE id = ?`)
        .bind(
          leadStatus, analysis.optOut ? 1 : 0,
          `${analysis.classification}: ${analysis.summary}`.slice(0, 2_000),
          analysis.optOut ? "" : tomorrow(), now, lead.id,
        ),
      db.prepare(`UPDATE email_campaign_recipients SET status = CASE WHEN ? = 1 THEN 'Stopped' ELSE 'Replied' END,
        replied_at = ?, updated_at = ? WHERE lead_id = ?
        AND (? = 1 OR (sent_at <> '' AND sent_at <= ?))
        AND status IN ('Queued','Awaiting','Completed')`)
        .bind(
          analysis.optOut ? 1 : 0, message.receivedAt, now, lead.id,
          analysis.optOut ? 1 : 0, message.receivedAt,
        ),
    ];
    if (lead.convertedOpportunityId) {
      const activityId = `ACT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      statements.push(
        db.prepare(`INSERT INTO activities (
          id, opportunity_id, activity_date, activity_type, contact_name, summary, outcome,
          next_step, due_date, owner, status, include_in_weekly_report, created_at, updated_at
        ) VALUES (?, ?, ?, 'Email', ?, ?, ?, ?, ?, 'Mai Trần Thành', 'Pending', 0, ?, ?)`)
          .bind(
            activityId, lead.convertedOpportunityId, message.receivedAt.slice(0, 10), lead.contactName,
            `Khách phản hồi email: ${analysis.summary}`, analysis.classification,
            analysis.suggestedAction, tomorrow(), now, now,
          ),
        db.prepare(`UPDATE opportunities SET last_contact_date = ?, next_step = ?, next_step_due = ?,
          updated_at = ? WHERE id = ?`).bind(
          message.receivedAt.slice(0, 10), analysis.suggestedAction, tomorrow(), now, lead.convertedOpportunityId,
        ),
      );
    }
    await db.batch(statements);
    added += 1;
  }
  return { scanned: messages.length, matched, added };
}

async function storedCampaignAssets(db: CrmDatabase, assetIdsJson: string) {
  const rows = await findEmailAssets(db, safeJsonArray(assetIdsJson));
  const stored = await Promise.all(rows.map(async (asset) => {
    const object = await emailFilesBucket().get(asset.objectKey);
    if (!object) throw new Error(`Không tìm thấy tệp ${asset.fileName} trong kho lưu trữ.`);
    return { ...asset, contentBase64: bytesToBase64(new Uint8Array(await object.arrayBuffer())) };
  }));
  return {
    contentImages: stored.filter((asset) => asset.fileKind === "image").map((asset) => ({
      contentId: `email-asset-${asset.id.toLowerCase()}`,
      filename: asset.fileName,
      contentType: asset.contentType,
      contentBase64: asset.contentBase64,
    })),
    attachments: stored.filter((asset) => asset.fileKind !== "image").map((asset) => ({
      filename: asset.fileName,
      contentType: asset.contentType,
      contentBase64: asset.contentBase64,
    })),
  };
}

async function completeFinishedCampaigns(db: CrmDatabase) {
  await db.prepare(`UPDATE email_campaigns SET status = 'Completed', updated_at = ?
    WHERE status = 'Active' AND NOT EXISTS (
      SELECT 1 FROM email_campaign_recipients r
      WHERE r.campaign_id = email_campaigns.id AND r.status IN ('Queued','Awaiting')
    )`).bind(new Date().toISOString()).run();
}

export async function runEmailAutomation(db: CrmDatabase, runType: "Scheduled" | "Manual", force = false, credentialKeyOverride?: string) {
  const runId = `RUN-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const startedAt = new Date().toISOString();
  await db.prepare(`INSERT INTO email_automation_runs (
      id, run_type, status, replies_added, sent_count, failed_count, error_message, started_at, completed_at
    ) VALUES (?, ?, 'Running', 0, 0, 0, '', ?, '')`).bind(runId, runType, startedAt).run();
  let repliesAdded = 0;
  let sent = 0;
  let failed = 0;
  try {
    const automation = await getAutomationSettings(db);
    if (!automation.enabled) {
      const skipped = "Tự động hóa đang tắt.";
      await db.prepare(`UPDATE email_automation_runs SET status = 'Completed', error_message = ?, completed_at = ? WHERE id = ?`)
        .bind(skipped, new Date().toISOString(), runId).run();
      return { repliesAdded, sent, failed, skipped };
    }
    const replyResult = await syncAndClassifyReplies(db, credentialKeyOverride);
    repliesAdded = replyResult.added;
    const local = vietnamNow();
    const inWorkingDay = !automation.weekdaysOnly || (local.weekday >= 1 && local.weekday <= 5);
    const inWindow = local.hour >= automation.sendStartHour && local.hour < automation.sendEndHour;
    if (!force && (!inWorkingDay || !inWindow)) {
      const skipped = "Ngoài khung giờ gửi đã cấu hình.";
      await db.prepare(`UPDATE email_automation_runs SET status = 'Completed', replies_added = ?,
        error_message = ?, completed_at = ? WHERE id = ?`)
        .bind(repliesAdded, skipped, new Date().toISOString(), runId).run();
      return { repliesAdded, sent, failed, skipped };
    }

    const sentTodayRow = await db.prepare(`SELECT COUNT(*) AS count FROM email_messages
      WHERE direction = 'outbound' AND status = 'Sent'
      AND date(datetime(sent_at, '+7 hours')) = ?`).bind(local.date).first<{ count: number }>();
    const remaining = Math.max(0, automation.dailyLimit - Number(sentTodayRow?.count || 0));
    if (!remaining) {
      const skipped = "Đã đạt giới hạn gửi email trong ngày.";
      await db.prepare(`UPDATE email_automation_runs SET status = 'Completed', replies_added = ?,
        error_message = ?, completed_at = ? WHERE id = ?`)
        .bind(repliesAdded, skipped, new Date().toISOString(), runId).run();
      return { repliesAdded, sent, failed, skipped };
    }

    const limit = Math.min(remaining, automation.batchSize);
    const queue = await db.prepare(`SELECT r.id, r.campaign_id AS campaignId, r.lead_id AS leadId,
      r.current_step AS currentStep, r.attempts, c.name AS campaignName,
      c.subject_template AS subjectTemplate, c.body_template AS bodyTemplate,
      c.follow_up_enabled AS followUpEnabled, c.follow_up_delay_days AS followUpDelayDays,
      c.follow_up_subject_template AS followUpSubjectTemplate,
      c.follow_up_body_template AS followUpBodyTemplate, c.sequence_json AS sequenceJson,
      c.asset_ids_json AS assetIdsJson, l.company_name AS companyName,
      l.contact_name AS contactName, l.title, l.industry, l.notes, l.email
      FROM email_campaign_recipients r
      JOIN email_campaigns c ON c.id = r.campaign_id
      JOIN prospecting_leads l ON l.id = r.lead_id
      WHERE c.status = 'Active' AND c.start_date <= ?
      AND r.status IN ('Queued','Awaiting') AND r.next_send_at <= ?
      AND l.email_opt_out = 0 AND l.status NOT IN ('Không nhận email','Đã chuyển cơ hội')
      ORDER BY r.next_send_at, r.created_at LIMIT ?`)
      .bind(local.date, startedAt, limit).all<QueuedRecipient>();
    const recipients = queue.results ?? [];
    if (!recipients.length) {
      await completeFinishedCampaigns(db);
      const skipped = "Chưa có Lead đến thời điểm gửi.";
      await db.prepare(`UPDATE email_automation_runs SET status = 'Completed', replies_added = ?,
        error_message = ?, completed_at = ? WHERE id = ?`)
        .bind(repliesAdded, skipped, new Date().toISOString(), runId).run();
      return { repliesAdded, sent, failed, skipped };
    }

    const { settings, password } = await connectionSettings(db, credentialKeyOverride);
    const client = await SmtpClient.open(settings, password);
    const assetCache = new Map<string, Awaited<ReturnType<typeof storedCampaignAssets>>>();
    try {
      for (const recipient of recipients) {
        const now = new Date().toISOString();
        const messageId = `EML-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
        const sequence = safeSequence(recipient.sequenceJson).length
          ? safeSequence(recipient.sequenceJson)
          : legacySequence(recipient);
        const currentStepIndex = Math.min(Math.max(recipient.currentStep, 0), sequence.length - 1);
        const currentStep = sequence[currentStepIndex];
        const subject = personalizeEmail(currentStep.subjectTemplate, recipient);
        const body = personalizeEmail(currentStep.bodyTemplate, recipient);
        let assets = assetCache.get(recipient.campaignId);
        if (!assets) {
          assets = await storedCampaignAssets(db, recipient.assetIdsJson);
          assetCache.set(recipient.campaignId, assets);
        }
        const branded = loriotEmailContent(body, assets.contentImages);
        try {
          const providerMessageId = await client.send({
            to: recipient.email,
            recipientName: recipient.contactName || recipient.companyName,
            subject,
            ...branded,
            attachments: assets.attachments,
          });
          const nextStepIndex = currentStepIndex + 1;
          const nextStep = sequence[nextStepIndex];
          const hasNextStep = Boolean(nextStep);
          const nextSendAt = hasNextStep ? addDays(now, nextStep.delayDays) : "";
          await db.batch([
            db.prepare(`INSERT INTO email_messages (
              id, lead_id, direction, sender_email, recipient_email, subject, body_text, status,
              campaign_id, provider_message_id, error_message, sent_at, received_at, created_at
            ) VALUES (?, ?, 'outbound', ?, ?, ?, ?, 'Sent', ?, ?, '', ?, '', ?)`)
              .bind(
                messageId, recipient.leadId, settings.fromEmail, recipient.email,
                subject, branded.text, recipient.campaignId, providerMessageId, now, now,
              ),
            db.prepare(`UPDATE email_campaign_recipients SET status = ?, current_step = ?, next_send_at = ?,
              sent_at = CASE WHEN sent_at = '' THEN ? ELSE sent_at END, attempts = attempts + 1,
              last_error = '', email_message_id = ?, updated_at = ? WHERE id = ?`)
              .bind(hasNextStep ? "Awaiting" : "Completed", hasNextStep ? nextStepIndex : currentStepIndex,
                nextSendAt, now, messageId, now, recipient.id),
            db.prepare(`UPDATE prospecting_leads SET last_email_date = ?, email_subject = ?,
              status = CASE WHEN converted_opportunity_id <> '' THEN status ELSE 'Chờ phản hồi' END,
              next_follow_up_date = ?, updated_at = ? WHERE id = ?`)
              .bind(local.date, subject, hasNextStep ? nextSendAt.slice(0, 10) : tomorrow(), now, recipient.leadId),
          ]);
          sent += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Không gửi được email.";
          const attempts = recipient.attempts + 1;
          const retryAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
          await db.batch([
            db.prepare(`INSERT INTO email_messages (
              id, lead_id, direction, sender_email, recipient_email, subject, body_text, status,
              campaign_id, provider_message_id, error_message, sent_at, received_at, created_at
            ) VALUES (?, ?, 'outbound', ?, ?, ?, ?, 'Failed', ?, ?, ?, '', '', ?)`)
              .bind(messageId, recipient.leadId, settings.fromEmail, recipient.email, subject, body,
                recipient.campaignId, `failed:${messageId}`, message.slice(0, 1_000), now),
            db.prepare(`UPDATE email_campaign_recipients SET status = ?, attempts = ?, last_error = ?,
              next_send_at = ?, updated_at = ? WHERE id = ?`)
              .bind(attempts >= 3 ? "Failed" : (currentStepIndex > 0 ? "Awaiting" : "Queued"), attempts,
                message.slice(0, 1_000), retryAt, now, recipient.id),
          ]);
          failed += 1;
        }
      }
    } finally {
      await client.close();
    }
    await completeFinishedCampaigns(db);
    const resultMessage = failed ? `${failed} email gửi thất bại.` : "";
    await db.prepare(`UPDATE email_automation_runs SET status = 'Completed', replies_added = ?,
      sent_count = ?, failed_count = ?, error_message = ?, completed_at = ? WHERE id = ?`)
      .bind(repliesAdded, sent, failed, resultMessage, new Date().toISOString(), runId).run();
    return { repliesAdded, sent, failed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể chạy tự động hóa email.";
    await db.prepare(`UPDATE email_automation_runs SET status = 'Failed', replies_added = ?,
      sent_count = ?, failed_count = ?, error_message = ?, completed_at = ? WHERE id = ?`)
      .bind(repliesAdded, sent, failed, message.slice(0, 1_000), new Date().toISOString(), runId).run();
    throw error;
  }
}

export async function getAutomationAnalytics(db: CrmDatabase): Promise<EmailAutomationAnalytics> {
  const today = vietnamNow().date;
  const [sentTotal, sentLeadTotal, sentToday, repliesTotal, converted, active, queued, lastRun] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM email_messages WHERE direction = 'outbound' AND status = 'Sent'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(DISTINCT lead_id) AS count FROM email_messages WHERE direction = 'outbound' AND status = 'Sent'").first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM email_messages WHERE direction = 'outbound' AND status = 'Sent'
      AND date(datetime(sent_at, '+7 hours')) = ?`).bind(today).first<{ count: number }>(),
    db.prepare("SELECT COUNT(DISTINCT lead_id) AS count FROM email_messages WHERE direction = 'inbound' AND status = 'Received'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM prospecting_leads WHERE converted_opportunity_id <> ''").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM email_campaigns WHERE status = 'Active'").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM email_campaign_recipients WHERE status IN ('Queued','Awaiting')").first<{ count: number }>(),
    db.prepare(`SELECT status, run_type AS runType, replies_added AS repliesAdded,
      sent_count AS sentCount, failed_count AS failedCount, error_message AS message,
      completed_at AS completedAt, started_at AS startedAt
      FROM email_automation_runs ORDER BY started_at DESC LIMIT 1`).first<{
        status: string;
        runType: string;
        repliesAdded: number;
        sentCount: number;
        failedCount: number;
        message: string;
        completedAt: string;
        startedAt: string;
      }>(),
  ]);
  const totalSent = Number(sentTotal?.count || 0);
  const totalSentLeads = Number(sentLeadTotal?.count || 0);
  const replies = Number(repliesTotal?.count || 0);
  return {
    sentTotal: totalSent,
    sentToday: Number(sentToday?.count || 0),
    repliesTotal: replies,
    replyRate: totalSentLeads ? replies / totalSentLeads : 0,
    convertedLeads: Number(converted?.count || 0),
    activeCampaigns: Number(active?.count || 0),
    queuedRecipients: Number(queued?.count || 0),
    lastRunAt: lastRun?.completedAt || lastRun?.startedAt || "",
    lastRunStatus: lastRun?.status || "Chưa chạy",
    lastRunType: lastRun?.runType || "",
    lastRunSent: Number(lastRun?.sentCount || 0),
    lastRunFailed: Number(lastRun?.failedCount || 0),
    lastRunRepliesAdded: Number(lastRun?.repliesAdded || 0),
    lastRunMessage: lastRun?.message || "",
  };
}

export async function loadAutomationData(db: CrmDatabase) {
  const [automation, campaigns, analytics] = await Promise.all([
    getAutomationSettings(db),
    listCampaigns(db),
    getAutomationAnalytics(db),
  ]);
  return { automation, campaigns, analytics, templates: INDUSTRY_EMAIL_TEMPLATES };
}
