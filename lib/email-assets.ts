import { env } from "cloudflare:workers";
import type { CrmDatabase } from "@/db";
import type { EmailAsset } from "@/lib/crm";

export const MAX_EMAIL_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_EMAIL_ASSETS = 5;
export const MAX_EMAIL_TOTAL_BYTES = 15 * 1024 * 1024;

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
};

const ALLOWED_CONTENT_TYPES = new Set(Object.values(EXTENSION_CONTENT_TYPES));

export type EmailAssetRow = EmailAsset & { objectKey: string };

type EmailFileObject = {
  body: ReadableStream<Uint8Array>;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type EmailFilesBucket = {
  get: (key: string) => Promise<EmailFileObject | null>;
  put: (key: string, value: ReadableStream<Uint8Array>, options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  }) => Promise<unknown>;
  delete: (key: string) => Promise<void>;
};

export const emailFilesBucket = () => {
  if (!env.EMAIL_FILES) throw new Error("Kho tệp email chưa được kết nối với CRM.");
  return env.EMAIL_FILES as unknown as EmailFilesBucket;
};

export const allowedEmailFileDescription = "JPG, PNG, GIF, WebP, PDF, Word, Excel, PowerPoint, CSV, TXT hoặc ZIP";

export const resolveEmailFileType = (file: Pick<File, "name" | "type">) => {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const byExtension = EXTENSION_CONTENT_TYPES[extension];
  const contentType = ALLOWED_CONTENT_TYPES.has(file.type) ? file.type : byExtension;
  return contentType && ALLOWED_CONTENT_TYPES.has(contentType) ? contentType : "";
};

export const emailFileKind = (contentType: string): EmailAsset["fileKind"] => contentType.startsWith("image/") ? "image" : "document";

export async function listEmailAssets(db: CrmDatabase) {
  const result = await db.prepare(`SELECT id, object_key AS objectKey, file_name AS fileName,
    content_type AS contentType, size_bytes AS sizeBytes, file_kind AS fileKind, created_at AS createdAt
    FROM email_assets ORDER BY created_at DESC LIMIT 300`).all<EmailAssetRow>();
  return result.results ?? [];
}

export async function findEmailAssets(db: CrmDatabase, ids: string[]) {
  const uniqueIds = [...new Set(ids)].slice(0, MAX_EMAIL_ASSETS);
  if (!uniqueIds.length) return [];
  const placeholders = uniqueIds.map(() => "?").join(",");
  const result = await db.prepare(`SELECT id, object_key AS objectKey, file_name AS fileName,
    content_type AS contentType, size_bytes AS sizeBytes, file_kind AS fileKind, created_at AS createdAt
    FROM email_assets WHERE id IN (${placeholders})`).bind(...uniqueIds).all<EmailAssetRow>();
  const rows = result.results ?? [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return uniqueIds.map((id) => byId.get(id)).filter((row): row is EmailAssetRow => Boolean(row));
}

export const publicEmailAsset = (asset: EmailAssetRow): EmailAsset => ({
  id: asset.id,
  fileName: asset.fileName,
  contentType: asset.contentType,
  sizeBytes: asset.sizeBytes,
  fileKind: asset.fileKind,
  createdAt: asset.createdAt,
});
