const BACKUP_FORMAT = "loriot-crm-d1-backup-v1";
const BACKUP_PREFIX = "system/backups/d1/";
export const LATEST_BACKUP_KEY = `${BACKUP_PREFIX}latest.json`;

const ROW_PAGE_SIZE = 500;
const BACKUPS_TO_KEEP = 90;
const UPLOAD_PART_BYTES = 5 * 1024 * 1024;
const encoder = new TextEncoder();
const CRM_TABLES = [
  "accounts",
  "contacts",
  "prospecting_leads",
  "email_settings",
  "email_assets",
  "email_messages",
  "email_automation_settings",
  "email_campaigns",
  "email_campaign_recipients",
  "email_automation_runs",
  "opportunities",
  "quotations",
  "quotation_items",
  "products",
  "pricing_settings",
  "inventory_items",
  "weekly_reports",
  "activities",
] as const;

type SchemaRecord = {
  type: "table" | "index" | "trigger" | "view";
  name: string;
  tableName: string;
  sql: string;
};

export type BackupSummary = {
  format: typeof BACKUP_FORMAT;
  key: string;
  createdAt: string;
  completedAt: string;
  tableCount: number;
  rowCount: number;
};

function backupTimestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, "-");
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function jsonLine(value: unknown): ArrayBuffer {
  const encoded = encoder.encode(`${JSON.stringify(value)}\n`);
  const copy = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  copy.set(encoded);
  return copy.buffer;
}

function safeJsonValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) {
    return { type: "base64", value: bytesToBase64(new Uint8Array(value)) };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      type: "base64",
      value: bytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
    };
  }
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function listBackupKeys(bucket: R2Bucket): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor, limit: 1_000 });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function pruneOldBackups(bucket: R2Bucket): Promise<void> {
  const keys = (await listBackupKeys(bucket))
    .filter((key) => key.endsWith(".jsonl.gz"))
    .sort()
    .reverse();
  const staleKeys = keys.slice(BACKUPS_TO_KEEP);
  for (let index = 0; index < staleKeys.length; index += 1_000) {
    await bucket.delete(staleKeys.slice(index, index + 1_000));
  }
}

// R2 requires known-length upload bodies. Buffer only one fixed-size part,
// rather than giving put() an unknown-length compression stream or buffering
// the entire database in the Worker isolate.
async function uploadCompressedBackup(
  bucket: R2Bucket,
  key: string,
  stream: ReadableStream<Uint8Array>,
  createdAt: string,
): Promise<R2Object> {
  const reader = stream.getReader();
  let multipart: R2MultipartUpload | undefined;
  try {
    multipart = await bucket.createMultipartUpload(key, {
      httpMetadata: {
        cacheControl: "no-store",
        contentEncoding: "gzip",
        contentType: "application/x-ndjson; charset=utf-8",
      },
      customMetadata: { createdAt, format: BACKUP_FORMAT },
    });
    const parts: R2UploadedPart[] = [];
    let buffer = new Uint8Array(UPLOAD_PART_BYTES);
    let used = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.byteLength) {
        const length = Math.min(UPLOAD_PART_BYTES - used, value.byteLength - offset);
        buffer.set(value.subarray(offset, offset + length), used);
        used += length;
        offset += length;
        if (used === UPLOAD_PART_BYTES) {
          parts.push(await multipart.uploadPart(parts.length + 1, buffer));
          buffer = new Uint8Array(UPLOAD_PART_BYTES);
          used = 0;
        }
      }
    }
    if (used > 0) parts.push(await multipart.uploadPart(parts.length + 1, buffer.subarray(0, used)));
    if (parts.length === 0) throw new Error("Bản sao nén không có dữ liệu.");
    return await multipart.complete(parts);
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    if (multipart) await multipart.abort().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function createD1Backup(
  database: D1Database,
  bucket: R2Bucket,
  scheduledTime = Date.now(),
): Promise<BackupSummary> {
  const createdAt = new Date(scheduledTime).toISOString();
  const key = `${BACKUP_PREFIX}${backupTimestamp(new Date(scheduledTime))}.jsonl.gz`;
  const placeholders = CRM_TABLES.map(() => "?").join(",");
  const schemaResult = await database.prepare(`SELECT
      type,
      name,
      tbl_name AS tableName,
      sql
    FROM sqlite_schema
    WHERE type IN ('table', 'index', 'trigger', 'view')
      AND tbl_name IN (${placeholders})
      AND sql IS NOT NULL
    ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`)
    .bind(...CRM_TABLES)
    .all<SchemaRecord>();
  const schema = schemaResult.results ?? [];
  const tables = schema.filter((record) => record.type === "table");
  if (!schemaResult.success || tables.length === 0) {
    throw new Error("Không tìm thấy bảng CRM để sao lưu.");
  }

  const stream = new TransformStream<BufferSource, BufferSource>();
  const writer = stream.writable.getWriter();
  const compressed = stream.readable.pipeThrough(new CompressionStream("gzip"));
  // Attach a rejection handler immediately: an R2 failure must also cancel
  // the reader so a backpressured producer cannot hang or reject unhandled.
  const upload = uploadCompressedBackup(bucket, key, compressed, createdAt)
    .then((object) => ({ object, error: null }), (error: unknown) => ({ object: null, error }));

  let rowCount = 0;
  try {
    await writer.write(jsonLine({ kind: "metadata", format: BACKUP_FORMAT, createdAt }));
    for (const record of schema) {
      await writer.write(jsonLine({ kind: "schema", ...record }));
    }

    for (const table of tables) {
      let offset = 0;
      while (true) {
        const page = await database
          .prepare(`SELECT * FROM ${quoteIdentifier(table.name)} ORDER BY rowid LIMIT ? OFFSET ?`)
          .bind(ROW_PAGE_SIZE, offset)
          .all<Record<string, unknown>>();
        const rows = page.results ?? [];
        if (!page.success) throw new Error(`Không đọc được bảng ${table.name}.`);
        for (const row of rows) {
          const values = Object.fromEntries(
            Object.entries(row).map(([column, value]) => [column, safeJsonValue(value)]),
          );
          await writer.write(jsonLine({ kind: "row", table: table.name, values }));
        }
        rowCount += rows.length;
        if (rows.length < ROW_PAGE_SIZE) break;
        offset += rows.length;
      }
    }

    const completedAt = new Date().toISOString();
    const summary: BackupSummary = {
      format: BACKUP_FORMAT,
      key,
      createdAt,
      completedAt,
      tableCount: tables.length,
      rowCount,
    };
    await writer.write(jsonLine({ kind: "summary", ...summary }));
    await writer.close();
    const uploaded = await upload;
    if (!uploaded.object) throw uploaded.error;

    const marker = await bucket.put(LATEST_BACKUP_KEY, JSON.stringify(summary), {
      httpMetadata: { cacheControl: "no-store", contentType: "application/json; charset=utf-8" },
      customMetadata: {
        createdAt,
        completedAt,
        format: BACKUP_FORMAT,
        rowCount: String(rowCount),
        tableCount: String(tables.length),
      },
    });
    if (!marker) throw new Error("Không lưu được trạng thái sao lưu hoàn tất.");
    await pruneOldBackups(bucket);
    return summary;
  } catch (error) {
    try {
      await writer.abort(error);
    } catch {
      // The stream can already be closed when R2 reports an upload failure.
    }
    await upload;
    throw error;
  }
}
