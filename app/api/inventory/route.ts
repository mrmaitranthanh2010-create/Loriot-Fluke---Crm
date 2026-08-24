import { ensureDatabase, ensureProductCatalog } from "@/db";
import type { InventoryItem, InventorySummary } from "@/lib/operations";

type Input = Record<string, unknown>;

const textValue = (input: Input, key: string, fallback = "") => {
  const value = input[key];
  return typeof value === "string" ? value.trim() : fallback;
};

const numberValue = (input: Input, key: string, fallback = 0) => {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
};

const normalizeModel = (value: string) => value.toUpperCase().replace(/^FLK[- ]?/, "").replace(/^FLUKE[- ]?/, "").replace(/[^A-Z0-9]+/g, " ").trim();

async function loadInventory(request: Request) {
  const db = await ensureProductCatalog();
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().toUpperCase();
  const inStockOnly = url.searchParams.get("inStock") === "1";
  const filters: string[] = [];
  const bindings: unknown[] = [];
  if (query) {
    filters.push("(UPPER(i.material_code) LIKE ? OR UPPER(i.item_no) LIKE ? OR UPPER(i.description) LIKE ? OR UPPER(p.model) LIKE ?)");
    const pattern = `%${query}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  if (inStockOnly) filters.push("i.quantity > 0");
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await db.prepare(`SELECT i.id, i.product_id AS productId, i.material_code AS materialCode,
      i.item_no AS itemNo, i.description, i.unit, i.quantity, i.report_date AS reportDate,
      i.source_file AS sourceFile, i.updated_at AS updatedAt, COALESCE(p.model, '') AS matchedModel,
      COALESCE(p.high_touch, 0) AS highTouch
    FROM inventory_items i LEFT JOIN products p ON p.id = i.product_id ${where}
    ORDER BY i.quantity DESC, i.material_code LIMIT 500`).bind(...bindings)
    .all<Omit<InventoryItem, "highTouch"> & { highTouch: number }>();
  const metrics = await db.prepare(`SELECT COUNT(*) AS skuCount,
      SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) AS inStockSkuCount,
      COALESCE(SUM(quantity), 0) AS totalQuantity,
      SUM(CASE WHEN quantity > 0 AND quantity <= 2 THEN 1 ELSE 0 END) AS lowStockCount,
      SUM(CASE WHEN product_id = '' THEN 1 ELSE 0 END) AS unmatchedCount,
      MAX(report_date) AS reportDate, MAX(source_file) AS sourceFile
    FROM inventory_items`).first<InventorySummary>();
  return {
    items: (result.results ?? []).map((item) => ({ ...item, highTouch: Boolean(item.highTouch) })),
    summary: metrics ?? { skuCount: 0, inStockSkuCount: 0, totalQuantity: 0, lowStockCount: 0, unmatchedCount: 0, reportDate: "", sourceFile: "" },
  };
}

async function importInventory(input: Input) {
  const db = await ensureProductCatalog();
  const rows = Array.isArray(input.rows) ? input.rows.filter((row): row is Input => Boolean(row) && typeof row === "object") : [];
  if (!rows.length) throw new Error("Không tìm thấy dòng tồn kho hợp lệ.");
  if (rows.length > 1000) throw new Error("File tồn kho vượt quá 1.000 dòng.");
  const now = new Date().toISOString();
  const sourceFile = textValue(input, "sourceFile", "File tồn kho Excel");
  const reportDate = textValue(input, "reportDate", now.slice(0, 10));
  const statements = [db.prepare("DELETE FROM inventory_items")];
  let matched = 0;

  for (const row of rows) {
    const materialCode = textValue(row, "materialCode");
    const itemNo = textValue(row, "itemNo");
    if (!materialCode) continue;
    const normalized = normalizeModel(materialCode);
    const pattern = `%${normalized.replaceAll(" ", "%")}%`;
    const candidates = await db.prepare(`SELECT id, model, normalized_model AS normalizedModel, item_no AS productItemNo
      FROM products WHERE (? <> '' AND (item_no = ? OR model = ?)) OR item_no = ?
        OR normalized_model LIKE ? OR UPPER(model) LIKE ? LIMIT 30`)
      .bind(itemNo, itemNo, itemNo, materialCode, pattern, pattern)
      .all<{ id: string; model: string; normalizedModel: string; productItemNo: string }>();
    const product = (candidates.results ?? []).find((candidate) => {
      if ([candidate.model, candidate.productItemNo].includes(itemNo) || [candidate.model, candidate.productItemNo].includes(materialCode)) return true;
      const candidateModel = normalizeModel(candidate.normalizedModel || candidate.model);
      return candidateModel === normalized || candidateModel.startsWith(`${normalized} `) || candidateModel.endsWith(` ${normalized}`);
    });
    if (product) matched += 1;
    statements.push(db.prepare(`INSERT INTO inventory_items (id, product_id, material_code, item_no, description,
      unit, quantity, report_date, source_file, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`INV-${crypto.randomUUID().slice(0, 12).toUpperCase()}`, product?.id ?? "", materialCode, itemNo,
        textValue(row, "description"), textValue(row, "unit", "Bộ"), Math.max(0, numberValue(row, "quantity")),
        reportDate, sourceFile, now));
  }
  for (let offset = 0; offset < statements.length; offset += 80) await db.batch(statements.slice(offset, offset + 80));
  return { imported: statements.length - 1, matched };
}

async function updateQuantity(input: Input) {
  const db = await ensureDatabase();
  const id = textValue(input, "id");
  if (!id) throw new Error("Thiếu mã tồn kho.");
  const result = await db.prepare("UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ?")
    .bind(Math.max(0, numberValue(input, "quantity")), new Date().toISOString(), id).run();
  if (!result.success) throw new Error("Không thể cập nhật số lượng.");
  return { updated: 1 };
}

export async function GET(request: Request) {
  try {
    return Response.json(await loadInventory(request));
  } catch (error) {
    console.error("Inventory load failed", error);
    return Response.json({ error: "Không thể tải dữ liệu tồn kho." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as Input;
    const action = textValue(input, "action");
    const result = action === "import" ? await importInventory(input) : action === "updateQuantity" ? await updateQuantity(input) : null;
    if (!result) throw new Error("Thao tác tồn kho không hợp lệ.");
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể cập nhật tồn kho.";
    console.error("Inventory mutation failed", error);
    return Response.json({ error: message }, { status: 400 });
  }
}
