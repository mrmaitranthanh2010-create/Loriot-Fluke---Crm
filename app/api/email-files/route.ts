import { ensureDatabase } from "@/db";
import {
  allowedEmailFileDescription,
  emailFileKind,
  emailFilesBucket,
  listEmailAssets,
  MAX_EMAIL_FILE_BYTES,
  publicEmailAsset,
  resolveEmailFileType,
} from "@/lib/email-assets";

const assertSameOrigin = (request: Request) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw new Error("Yêu cầu kho tệp không đúng nguồn CRM.");
};

const assetPayload = async () => {
  const db = await ensureDatabase();
  return { assets: (await listEmailAssets(db)).map(publicEmailAsset) };
};

const safeFileName = (value: string) => value
  .replace(/[\\/\r\n\t]+/g, "_")
  .replace(/[<>:"|?*]+/g, "_")
  .trim()
  .slice(0, 180) || "email-file";

const contentDisposition = (fileName: string, download: boolean) => {
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim();
    if (!id) return Response.json(await assetPayload());
    const db = await ensureDatabase();
    const row = await db.prepare(`SELECT object_key AS objectKey, file_name AS fileName,
      content_type AS contentType FROM email_assets WHERE id = ?`).bind(id).first<{
        objectKey: string;
        fileName: string;
        contentType: string;
      }>();
    if (!row) return Response.json({ error: "Không tìm thấy tệp." }, { status: 404 });
    const object = await emailFilesBucket().get(row.objectKey);
    if (!object) return Response.json({ error: "Tệp không còn tồn tại trong kho lưu trữ." }, { status: 404 });
    const download = url.searchParams.get("download") === "1";
    return new Response(object.body, {
      headers: {
        "Content-Type": row.contentType,
        "Content-Length": String(object.size),
        "Content-Disposition": contentDisposition(row.fileName, download),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể đọc kho tệp email.";
    console.error(JSON.stringify({ message: "email asset read failed", error: message }));
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  let objectKey = "";
  try {
    assertSameOrigin(request);
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_EMAIL_FILE_BYTES + 1024 * 1024) throw new Error("Tệp vượt quá giới hạn 10 MB.");
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) throw new Error("Vui lòng chọn một tệp từ máy tính.");
    if (value.size < 1) throw new Error("Tệp đang trống.");
    if (value.size > MAX_EMAIL_FILE_BYTES) throw new Error("Mỗi tệp được phép tối đa 10 MB.");
    const contentType = resolveEmailFileType(value);
    if (!contentType) throw new Error(`Định dạng chưa được hỗ trợ. Vui lòng dùng ${allowedEmailFileDescription}.`);

    const db = await ensureDatabase();
    const id = `EAF-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const fileName = safeFileName(value.name);
    objectKey = `email-assets/${id}/${fileName}`;
    await emailFilesBucket().put(objectKey, value.stream(), {
      httpMetadata: { contentType },
      customMetadata: { fileName },
    });
    const now = new Date().toISOString();
    try {
      await db.prepare(`INSERT INTO email_assets (
        id, object_key, file_name, content_type, size_bytes, file_kind, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        id, objectKey, fileName, contentType, value.size, emailFileKind(contentType), now,
      ).run();
    } catch (error) {
      await emailFilesBucket().delete(objectKey);
      throw error;
    }
    return Response.json(await assetPayload(), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể tải tệp lên.";
    console.error(JSON.stringify({ message: "email asset upload failed", objectKey, error: message }));
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const value: unknown = await request.json();
    const id = value && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string"
      ? (value as { id: string }).id.trim()
      : "";
    if (!id) throw new Error("Thiếu mã tệp cần xóa.");
    const db = await ensureDatabase();
    const row = await db.prepare("SELECT object_key AS objectKey FROM email_assets WHERE id = ?")
      .bind(id).first<{ objectKey: string }>();
    if (!row) throw new Error("Tệp đã được xóa hoặc không còn tồn tại.");
    await emailFilesBucket().delete(row.objectKey);
    await db.prepare("DELETE FROM email_assets WHERE id = ?").bind(id).run();
    return Response.json(await assetPayload());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể xóa tệp.";
    console.error(JSON.stringify({ message: "email asset delete failed", error: message }));
    return Response.json({ error: message }, { status: 400 });
  }
}
