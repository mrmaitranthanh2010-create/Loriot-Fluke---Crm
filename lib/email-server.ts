import { connect, type Socket } from "cloudflare:sockets";
import { env } from "cloudflare:workers";

export type SmtpSecurity = "ssl" | "starttls";

export type EmailConnectionSettings = {
  fromEmail: string;
  fromName: string;
  username: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  imapHost: string;
  imapPort: number;
};

export type OutboundEmail = {
  to: string;
  recipientName: string;
  subject: string;
  text: string;
  html?: string;
  inlineImages?: Array<{
    contentId: string;
    filename: string;
    contentType: string;
    contentBase64: string;
  }>;
  attachments?: Array<{
    filename: string;
    contentType: string;
    contentBase64: string;
  }>;
};

export type IncomingEmailHeader = {
  messageId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  bodyText: string;
  receivedAt: string;
};

const encoder = new TextEncoder();

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const utf8Base64 = (value: string) => bytesToBase64(encoder.encode(value));

const credentialSecret = () => {
  const value = env.MAIL_CREDENTIAL_KEY;
  if (typeof value !== "string" || value.trim().length < 24) {
    throw new Error("CRM chưa được cấu hình khóa bảo mật cho tài khoản email.");
  }
  return value.trim();
};

export const hasEmailCredentialKey = () => {
  const value = env.MAIL_CREDENTIAL_KEY;
  return typeof value === "string" && value.trim().length >= 24;
};

async function credentialKey() {
  const secret = credentialSecret();
  let keyBytes: Uint8Array;
  try {
    const decoded = base64ToBytes(secret);
    keyBytes = decoded.length === 32
      ? decoded
      : new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret)));
  } catch {
    keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret)));
  }
  const keyMaterial = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyMaterial).set(keyBytes);
  return crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptEmailPassword(password: string) {
  const value = password.trim();
  if (!value) throw new Error("Vui lòng nhập mật khẩu email.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await credentialKey();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return {
    passwordCiphertext: bytesToBase64(new Uint8Array(ciphertext)),
    passwordIv: bytesToBase64(iv),
  };
}

export async function decryptEmailPassword(passwordCiphertext: string, passwordIv: string) {
  if (!passwordCiphertext || !passwordIv) throw new Error("Tài khoản email chưa có mật khẩu kết nối.");
  try {
    const key = await credentialKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(passwordIv) },
      key,
      base64ToBytes(passwordCiphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Không thể mở thông tin đăng nhập email. Vui lòng nhập lại mật khẩu trong CRM.");
  }
}

const withTimeout = async <T>(promise: Promise<T>, message: string, timeoutMs = 15_000): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

class SocketChannel {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = "";

  constructor(private readonly socket: Socket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  async readLine() {
    while (true) {
      const lineEnd = this.buffer.indexOf("\n");
      if (lineEnd >= 0) {
        const line = this.buffer.slice(0, lineEnd + 1);
        this.buffer = this.buffer.slice(lineEnd + 1);
        return line.replace(/\r?\n$/, "");
      }
      const result = await withTimeout(this.reader.read(), "Máy chủ email phản hồi quá chậm.");
      if (result.done) {
        if (this.buffer) {
          const remainder = this.buffer;
          this.buffer = "";
          return remainder;
        }
        throw new Error("Máy chủ email đã đóng kết nối.");
      }
      this.buffer += this.decoder.decode(result.value, { stream: true });
    }
  }

  async writeLine(value: string) {
    await withTimeout(this.writer.write(encoder.encode(`${value}\r\n`)), "Không thể gửi lệnh tới máy chủ email.");
  }

  async write(value: string) {
    await withTimeout(this.writer.write(encoder.encode(value)), "Không thể gửi nội dung tới máy chủ email.");
  }

  release() {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }

  async close() {
    this.release();
    await this.socket.close().catch(() => undefined);
  }
}

type SmtpResponse = { code: number; lines: string[]; raw: string };

async function readSmtpResponse(channel: SocketChannel): Promise<SmtpResponse> {
  const first = await channel.readLine();
  const code = Number(first.slice(0, 3));
  if (!Number.isInteger(code)) throw new Error(`Phản hồi SMTP không hợp lệ: ${first.slice(0, 120)}`);
  const lines = [first];
  if (first[3] === "-") {
    while (true) {
      const line = await channel.readLine();
      lines.push(line);
      if (line.startsWith(`${code} `)) break;
      if (lines.length > 80) throw new Error("Phản hồi SMTP quá dài.");
    }
  }
  return { code, lines, raw: lines.join("\n") };
}

const expectSmtp = (response: SmtpResponse, expected: number[]) => {
  if (!expected.includes(response.code)) {
    throw new Error(`Máy chủ SMTP từ chối yêu cầu (${response.code}): ${response.lines.at(-1)?.slice(4, 180) || "Không rõ lý do"}`);
  }
};

const headerText = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const validEmail = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

const encodedHeader = (value: string) => {
  const safe = headerText(value);
  return /^[\x20-\x7E]*$/.test(safe) ? safe : `=?UTF-8?B?${utf8Base64(safe)}?=`;
};

const addressHeader = (name: string, email: string) => {
  const safeEmail = headerText(email).toLowerCase();
  if (!validEmail(safeEmail)) throw new Error(`Địa chỉ email không hợp lệ: ${safeEmail || "(trống)"}`);
  const safeName = encodedHeader(name);
  return safeName ? `${safeName} <${safeEmail}>` : `<${safeEmail}>`;
};

const wrapBase64 = (value: string) => value.match(/.{1,76}/g)?.join("\r\n") || "";

function mimeMessage(settings: EmailConnectionSettings, email: OutboundEmail) {
  const messageIdDomain = settings.fromEmail.split("@")[1] || "loriot.com.vn";
  const messageId = `<${crypto.randomUUID()}@${messageIdDomain}>`;
  const text = email.text.replace(/\r?\n/g, "\r\n");
  const headers = [
    `From: ${addressHeader(settings.fromName, settings.fromEmail)}`,
    `To: ${addressHeader(email.recipientName, email.to)}`,
    `Subject: ${encodedHeader(email.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    "X-Mailer: Loriot Fluke CRM",
  ];
  const attachments = email.attachments ?? [];
  if (!email.html && attachments.length === 0) {
    headers.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64");
    return { messageId, raw: `${headers.join("\r\n")}\r\n\r\n${wrapBase64(utf8Base64(text))}\r\n` };
  }

  const mixedBoundary = `mixed_${crypto.randomUUID().replace(/-/g, "")}`;
  const relatedBoundary = `related_${crypto.randomUUID().replace(/-/g, "")}`;
  const alternativeBoundary = `alternative_${crypto.randomUUID().replace(/-/g, "")}`;
  headers.push(attachments.length
    ? `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`
    : `Content-Type: multipart/related; boundary="${relatedBoundary}"`);
  const parts: string[] = [];

  if (email.html) {
    if (attachments.length) parts.push(`--${mixedBoundary}`, `Content-Type: multipart/related; boundary="${relatedBoundary}"`, "");
    parts.push(
      `--${relatedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      "",
      `--${alternativeBoundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(utf8Base64(text)),
      `--${alternativeBoundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(utf8Base64(email.html)),
      `--${alternativeBoundary}--`,
    );
    for (const image of email.inlineImages ?? []) {
      const contentId = headerText(image.contentId).replace(/[<>]/g, "");
      const filename = headerText(image.filename).replace(/[";]/g, "_");
      const contentType = /^[a-z]+\/[a-z0-9.+-]+$/i.test(image.contentType) ? image.contentType : "application/octet-stream";
      parts.push(
        `--${relatedBoundary}`,
        `Content-Type: ${contentType}; name="${filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-ID: <${contentId}>`,
        `Content-Disposition: inline; filename="${filename}"`,
        "",
        wrapBase64(image.contentBase64.replace(/\s+/g, "")),
      );
    }
    parts.push(`--${relatedBoundary}--`);
  } else {
    parts.push(
      `--${mixedBoundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(utf8Base64(text)),
    );
  }

  for (const attachment of attachments) {
    const filename = headerText(attachment.filename).replace(/[";]/g, "_");
    const contentType = /^[a-z]+\/[a-z0-9.+-]+$/i.test(attachment.contentType) ? attachment.contentType : "application/octet-stream";
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${contentType}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      wrapBase64(attachment.contentBase64.replace(/\s+/g, "")),
    );
  }
  if (attachments.length) parts.push(`--${mixedBoundary}--`);
  parts.push("");
  return { messageId, raw: `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}` };
}

export class SmtpClient {
  private constructor(
    private socket: Socket,
    private channel: SocketChannel,
    private readonly settings: EmailConnectionSettings,
  ) {}

  static async open(settings: EmailConnectionSettings, password: string) {
    if (!settings.smtpHost || !settings.smtpPort) throw new Error("Thiếu máy chủ hoặc cổng SMTP.");
    const socket = connect(
      { hostname: settings.smtpHost, port: settings.smtpPort },
      { secureTransport: settings.smtpSecurity === "starttls" ? "starttls" : "on" },
    );
    await withTimeout(socket.opened, "Không thể kết nối máy chủ SMTP.");
    let channel = new SocketChannel(socket);
    let activeSocket = socket;
    expectSmtp(await readSmtpResponse(channel), [220]);
    await channel.writeLine("EHLO loriot-crm.local");
    expectSmtp(await readSmtpResponse(channel), [250]);

    if (settings.smtpSecurity === "starttls") {
      await channel.writeLine("STARTTLS");
      expectSmtp(await readSmtpResponse(channel), [220]);
      channel.release();
      activeSocket = socket.startTls();
      await withTimeout(activeSocket.opened, "Không thể nâng cấp kết nối SMTP lên TLS.");
      channel = new SocketChannel(activeSocket);
      await channel.writeLine("EHLO loriot-crm.local");
      expectSmtp(await readSmtpResponse(channel), [250]);
    }

    await channel.writeLine("AUTH LOGIN");
    expectSmtp(await readSmtpResponse(channel), [334]);
    await channel.writeLine(utf8Base64(settings.username));
    expectSmtp(await readSmtpResponse(channel), [334]);
    await channel.writeLine(utf8Base64(password));
    expectSmtp(await readSmtpResponse(channel), [235]);
    return new SmtpClient(activeSocket, channel, settings);
  }

  async send(email: OutboundEmail) {
    if (!validEmail(email.to)) throw new Error(`Email người nhận không hợp lệ: ${email.to}`);
    const message = mimeMessage(this.settings, email);
    await this.channel.writeLine(`MAIL FROM:<${this.settings.fromEmail}>`);
    expectSmtp(await readSmtpResponse(this.channel), [250]);
    await this.channel.writeLine(`RCPT TO:<${email.to}>`);
    expectSmtp(await readSmtpResponse(this.channel), [250, 251]);
    await this.channel.writeLine("DATA");
    expectSmtp(await readSmtpResponse(this.channel), [354]);
    const dotSafe = message.raw.replace(/(^|\r\n)\./g, "$1..");
    await this.channel.write(`${dotSafe}\r\n.\r\n`);
    expectSmtp(await readSmtpResponse(this.channel), [250]);
    return message.messageId;
  }

  async close() {
    try {
      await this.channel.writeLine("QUIT");
      await readSmtpResponse(this.channel).catch(() => undefined);
    } finally {
      await this.channel.close();
      await this.socket.closed.catch(() => undefined);
    }
  }
}

const imapQuote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const imapDate = (date: Date) => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(date.getUTCDate()).padStart(2, "0")}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
};

const decodeQuotedPrintable = (value: string) => value
  .replace(/_/g, " ")
  .replace(/=([A-Fa-f0-9]{2})/g, (_, pair: string) => String.fromCharCode(Number.parseInt(pair, 16)));

const decodeMimeWord = (value: string) => value.replace(
  /=\?UTF-8\?([BQ])\?([^?]+)\?=/gi,
  (_, encoding: string, payload: string) => {
    try {
      if (encoding.toUpperCase() === "B") return new TextDecoder().decode(base64ToBytes(payload));
      return new TextDecoder().decode(Uint8Array.from(decodeQuotedPrintable(payload), (character) => character.charCodeAt(0)));
    } catch {
      return payload;
    }
  },
);

const headerValue = (raw: string, name: string) => {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  return unfolded.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() || "";
};

const decodeIncomingBody = (raw: string, headerRaw: string) => {
  const literal = raw.match(/\{\d+\}\r?\n([\s\S]*)/i)?.[1] || "";
  let value = literal.replace(/\r?\n\)\r?\nA\d+ OK[\s\S]*$/i, "").trim();
  const transferEncoding = headerValue(headerRaw, "Content-Transfer-Encoding").toLowerCase();
  try {
    if (transferEncoding === "base64") value = new TextDecoder().decode(base64ToBytes(value.replace(/\s+/g, "")));
    else if (transferEncoding === "quoted-printable") value = decodeQuotedPrintable(value.replace(/=\r?\n/g, ""));
  } catch {
    // Keep the bounded raw preview if the sender used an unsupported encoding.
  }
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 8_000);
};

const parseIncomingHeader = (raw: string, bodyText = ""): IncomingEmailHeader | null => {
  const from = decodeMimeWord(headerValue(raw, "From"));
  const fromEmail = (from.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1]
    || from.match(/[^\s<>]+@[^\s<>]+/)?.[0]
    || "").toLowerCase();
  if (!validEmail(fromEmail)) return null;
  const fromName = from.replace(/<[^<>]+>/, "").replace(/^"|"$/g, "").trim();
  const rawDate = headerValue(raw, "Date");
  const parsedDate = new Date(rawDate);
  const subject = decodeMimeWord(headerValue(raw, "Subject")) || "(Không có tiêu đề)";
  return {
    messageId: headerValue(raw, "Message-ID") || `imap:${fromEmail}:${rawDate}:${subject}`,
    fromEmail,
    fromName,
    subject,
    bodyText,
    receivedAt: Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString(),
  };
};

export class ImapClient {
  private tagCounter = 1;

  private constructor(private readonly channel: SocketChannel) {}

  static async open(settings: EmailConnectionSettings, password: string) {
    if (!settings.imapHost || !settings.imapPort) throw new Error("Thiếu máy chủ hoặc cổng IMAP.");
    const socket = connect(
      { hostname: settings.imapHost, port: settings.imapPort },
      { secureTransport: "on" },
    );
    await withTimeout(socket.opened, "Không thể kết nối máy chủ IMAP.");
    const channel = new SocketChannel(socket);
    const greeting = await channel.readLine();
    if (!/^\*\s+(OK|PREAUTH)\b/i.test(greeting)) {
      await channel.close();
      throw new Error(`Máy chủ IMAP không sẵn sàng: ${greeting.slice(0, 160)}`);
    }
    const client = new ImapClient(channel);
    await client.command(`LOGIN ${imapQuote(settings.username)} ${imapQuote(password)}`);
    await client.command("SELECT INBOX");
    return client;
  }

  private async command(command: string) {
    const tag = `A${String(this.tagCounter++).padStart(4, "0")}`;
    await this.channel.writeLine(`${tag} ${command}`);
    const lines: string[] = [];
    while (true) {
      const line = await this.channel.readLine();
      lines.push(line);
      if (line.startsWith(`${tag} `)) {
        if (!new RegExp(`^${tag} OK\\b`, "i").test(line)) {
          throw new Error(`Máy chủ IMAP từ chối yêu cầu: ${line.slice(tag.length + 1, 180)}`);
        }
        return lines.join("\r\n");
      }
      if (lines.length > 1_000) throw new Error("Phản hồi IMAP quá dài.");
    }
  }

  async recentHeaders(days = 30, limit = 50) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - Math.max(1, Math.min(90, days)));
    const search = await this.command(`SEARCH SINCE ${imapDate(since)}`);
    const sequenceIds = search.match(/^\* SEARCH\s*(.*)$/im)?.[1]?.trim().split(/\s+/).filter(Boolean) || [];
    const selected = sequenceIds.slice(-Math.max(1, Math.min(100, limit)));
    const messages: IncomingEmailHeader[] = [];
    for (const sequenceId of selected) {
      if (!/^\d+$/.test(sequenceId)) continue;
      const raw = await this.command(`FETCH ${sequenceId} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING)])`);
      const bodyRaw = await this.command(`FETCH ${sequenceId} (BODY.PEEK[TEXT]<0.12000>)`);
      const parsed = parseIncomingHeader(raw, decodeIncomingBody(bodyRaw, raw));
      if (parsed) messages.push(parsed);
    }
    return messages;
  }

  async close() {
    try {
      await this.command("LOGOUT").catch(() => undefined);
    } finally {
      await this.channel.close();
    }
  }
}
