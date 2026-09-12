import handler from "vinext/server/app-router-entry";
import { routeAgentRequest } from "agents";
import { LoriotSalesAgent } from "./sales-agent";

export { LoriotSalesAgent };

type HandlerEnv = NonNullable<Parameters<typeof handler.fetch>[1]>;
type HandlerContext = NonNullable<Parameters<typeof handler.fetch>[2]>;

interface Env extends HandlerEnv {
  CRM_AUTH_USERNAME?: string;
  CRM_AUTH_PASSWORD?: string;
  MAIL_CREDENTIAL_KEY?: string;
}

type ScheduledEvent = { cron: string };

const SESSION_COOKIE = "loriot_crm_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
const MAX_LOGIN_BODY_BYTES = 4_096;
const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function secureTextEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(leftHash, rightHash);
  }

  // Node's Web Crypto does not expose Cloudflare's timingSafeEqual extension.
  // The inputs are fixed-size SHA-256 digests, so this fallback is safe for tests.
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

async function sessionKey(password: string): Promise<CryptoKey> {
  const keyBytes = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`loriot-crm-session-v1:${password}`),
  );
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function createSessionToken(username: string, password: string): Promise<string> {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    user: username,
    expiresAt: Date.now() + SESSION_DURATION_SECONDS * 1_000,
  })));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await sessionKey(password),
    encoder.encode(payload),
  );
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifySessionToken(token: string, username: string, password: string): Promise<boolean> {
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) return false;
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      await sessionKey(password),
      base64UrlToBytes(signature),
      encoder.encode(payload),
    );
    if (!validSignature) return false;

    const session = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as {
      user?: unknown;
      expiresAt?: unknown;
    };
    return session.user === username
      && typeof session.expiresAt === "number"
      && Number.isFinite(session.expiresAt)
      && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function cookieValue(request: Request, name: string): string {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [candidateName, ...candidateValue] = part.trim().split("=");
    if (candidateName === name) return candidateValue.join("=");
  }
  return "";
}

function securityHeaders(contentType: string): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function loginPage(errorMessage = ""): Response {
  const error = errorMessage
    ? `<div class="error" role="alert">${errorMessage}</div>`
    : "";
  return new Response(`<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Đăng nhập | Loriot Fluke CRM</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #172033; background: radial-gradient(circle at top right, #fff5d1 0, transparent 34%), linear-gradient(145deg, #f7f3ea, #ffffff 58%); }
    main { width: min(100%, 430px); padding: 40px; border: 1px solid #e6dfd1; border-radius: 24px; background: rgba(255,255,255,.96); box-shadow: 0 24px 70px rgba(34,39,52,.14); }
    .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 32px; }
    .mark { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; color: #191d27; background: linear-gradient(145deg, #ffd34d, #e9a900); font-size: 24px; font-weight: 900; box-shadow: 0 10px 24px rgba(225,166,0,.25); }
    .brand strong { display: block; font-size: 18px; letter-spacing: .1em; }
    .brand span { color: #7a8291; font-size: 11px; font-weight: 700; letter-spacing: .17em; }
    h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: -.03em; }
    p { margin: 0 0 28px; color: #697386; line-height: 1.55; }
    label { display: block; margin: 0 0 8px; color: #40485a; font-size: 13px; font-weight: 750; }
    input { width: 100%; height: 50px; margin: 0 0 18px; padding: 0 15px; border: 1px solid #d8dce4; border-radius: 12px; color: #172033; background: #fff; font-size: 16px; outline: none; transition: border-color .18s, box-shadow .18s; }
    input:focus { border-color: #d39b00; box-shadow: 0 0 0 4px rgba(240,181,0,.15); }
    button { width: 100%; height: 52px; margin-top: 8px; border: 0; border-radius: 12px; color: #171b24; background: linear-gradient(135deg, #ffd247, #f2b900); font-size: 15px; font-weight: 850; cursor: pointer; box-shadow: 0 12px 24px rgba(219,163,0,.23); }
    button:hover { filter: brightness(.98); transform: translateY(-1px); }
    .error { margin: 0 0 18px; padding: 12px 14px; border: 1px solid #efc1bc; border-radius: 10px; color: #9b2c23; background: #fff3f1; font-size: 13px; line-height: 1.45; }
    footer { margin-top: 24px; color: #9aa1ad; font-size: 11px; text-align: center; }
    @media (max-width: 520px) { main { padding: 30px 24px; border-radius: 20px; } }
  </style>
</head>
<body>
  <main>
    <div class="brand"><div class="mark">L</div><div><strong>LORIOT</strong><span>FLUKE CRM</span></div></div>
    <h1>Chào anh Thành</h1>
    <p>Đăng nhập để tiếp tục vào không gian quản lý bán hàng.</p>
    ${error}
    <form method="post" action="/__auth/login">
      <label for="username">Tên đăng nhập</label>
      <input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
      <label for="password">Mật khẩu</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Đăng nhập CRM</button>
    </form>
    <footer>Loriot Industrial · Kết nối bảo mật</footer>
  </main>
</body>
</html>`, {
    status: errorMessage ? 401 : 200,
    headers: securityHeaders("text/html; charset=utf-8"),
  });
}

function unauthorizedApi(): Response {
  return Response.json(
    { error: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." },
    { status: 401, headers: securityHeaders("application/json; charset=utf-8") },
  );
}

async function readLoginBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_LOGIN_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function handleLogin(request: Request, username: string, password: string): Promise<Response> {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return new Response("Định dạng đăng nhập không hợp lệ.", {
      status: 415,
      headers: securityHeaders("text/plain; charset=utf-8"),
    });
  }
  const body = await readLoginBody(request);
  if (body === null) {
    return new Response("Dữ liệu đăng nhập quá lớn.", {
      status: 413,
      headers: securityHeaders("text/plain; charset=utf-8"),
    });
  }
  const form = new URLSearchParams(body);
  const providedUsername = (form.get("username") || "").trim();
  const providedPassword = form.get("password") || "";
  const [validUsername, validPassword] = await Promise.all([
    secureTextEqual(providedUsername, username),
    secureTextEqual(providedPassword, password),
  ]);
  if (!validUsername || !validPassword) {
    return loginPage("Tên đăng nhập hoặc mật khẩu chưa đúng. Anh vui lòng kiểm tra và thử lại.");
  }

  const token = await createSessionToken(username, password);
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Location: "/",
      "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_DURATION_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

async function isAuthenticated(request: Request, username: string, password: string): Promise<boolean> {
  const authorization = request.headers.get("Authorization") || "";
  if (authorization.startsWith("Basic ")) {
    const expectedBytes = encoder.encode(`${username}:${password}`);
    const expected = `Basic ${bytesToBase64(expectedBytes)}`;
    if (await secureTextEqual(authorization, expected)) return true;
  }
  const session = cookieValue(request, SESSION_COOKIE);
  return session ? verifySessionToken(session, username, password) : false;
}

function isPublicStaticAsset(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return new URL(request.url).pathname.startsWith("/_next/static/");
}

const worker = {
  async fetch(request: Request, env: Env, ctx: HandlerContext): Promise<Response> {
    // Static build artifacts contain no CRM records or secrets. Keeping them
    // outside Basic Auth lets the browser finish loading after the HTML login.
    if (isPublicStaticAsset(request)) return handler.fetch(request, env, ctx);

    const username = env.CRM_AUTH_USERNAME?.trim() || "mai";
    const password = env.CRM_AUTH_PASSWORD;
    if (!password) {
      return new Response("CRM đang chờ cấu hình mật khẩu bảo mật.", {
        status: 503,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === "/__auth/login" && request.method === "GET") return loginPage();
    if (url.pathname === "/__auth/login" && request.method === "POST") {
      return handleLogin(request, username, password);
    }
    if (url.pathname === "/__auth/logout" && request.method === "POST") {
      return new Response(null, {
        status: 303,
        headers: {
          "Cache-Control": "no-store",
          Location: "/__auth/login",
          "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }

    if (!await isAuthenticated(request, username, password)) {
      const acceptsHtml = request.method === "GET"
        && (request.headers.get("Accept") || "").includes("text/html");
      return acceptsHtml ? loginPage() : unauthorizedApi();
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return handler.fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledEvent, env: Env): Promise<void> {
    try {
      const [{ ensureDatabase }, { runEmailAutomation }] = await Promise.all([
        import("@/db"),
        import("@/lib/email-automation"),
      ]);
      const db = await ensureDatabase();
      const result = await runEmailAutomation(db, "Scheduled", false, env.MAIL_CREDENTIAL_KEY);
      console.log(JSON.stringify({
        message: "scheduled email automation completed",
        cron: controller.cron,
        ...result,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        message: "scheduled email automation failed",
        cron: controller.cron,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  },
};

export default worker;
