import handler from "vinext/server/app-router-entry";

type HandlerEnv = NonNullable<Parameters<typeof handler.fetch>[1]>;
type HandlerContext = NonNullable<Parameters<typeof handler.fetch>[2]>;

interface Env extends HandlerEnv {
  CRM_AUTH_USERNAME?: string;
  CRM_AUTH_PASSWORD?: string;
}

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function unauthorized(): Response {
  return new Response("Vui lòng đăng nhập để sử dụng Loriot Fluke CRM.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "WWW-Authenticate": 'Basic realm="Loriot Fluke CRM", charset="UTF-8"',
    },
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: HandlerContext): Promise<Response> {
    const username = env.CRM_AUTH_USERNAME?.trim() || "mai";
    const password = env.CRM_AUTH_PASSWORD;
    if (!password) {
      return new Response("CRM đang chờ cấu hình mật khẩu bảo mật.", {
        status: 503,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const expected = `Basic ${utf8Base64(`${username}:${password}`)}`;
    const provided = request.headers.get("Authorization") || "";
    if (!constantTimeEqual(provided, expected)) return unauthorized();

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
