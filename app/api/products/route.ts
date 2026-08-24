import { ensureProductCatalog } from "@/db";
import type { Product } from "@/lib/crm";
import { calculateVndPrice } from "@/lib/pricing";
import { getPricingSettings } from "@/lib/pricing-server";

type Input = Record<string, unknown>;

const textValue = (input: Input, key: string, fallback = "") => {
  const value = input[key];
  return typeof value === "string" ? value.trim() : fallback;
};

const numberValue = (input: Input, key: string, fallback = 0) => {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
};

const normalizeModel = (value: string) => value.toUpperCase().replace(/\s+/g, " ").trim();

const productSelect = `SELECT id, product_family AS productFamily, model_group AS modelGroup,
  market_model AS marketModel, model, normalized_model AS normalizedModel, item_no AS itemNo,
  description, country_of_origin AS countryOfOrigin, list_price_usd AS listPriceUsd,
  list_price_vnd AS listPriceVnd, item_status AS itemStatus, gross_weight AS grossWeight, uom,
  warranty_text AS warrantyText, high_touch AS highTouch, price_source AS priceSource,
  high_touch_source AS highTouchSource, updated_at AS updatedAt,
  COALESCE((SELECT quantity FROM inventory_items i WHERE i.product_id = products.id OR (i.item_no <> '' AND i.item_no = products.item_no) LIMIT 1), 0) AS stockQuantity
  FROM products`;

async function loadProducts(request: Request) {
  const db = await ensureProductCatalog();
  const url = new URL(request.url);
  const query = normalizeModel(url.searchParams.get("q") ?? "");
  const suggestionMode = url.searchParams.get("mode") === "suggest";
  const highTouch = url.searchParams.get("highTouch") === "1";
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 80));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const filters: string[] = [];
  const bindings: unknown[] = [];
  if (query) {
    const pattern = `%${query}%`;
    if (suggestionMode) {
      filters.push("(normalized_model LIKE ? OR UPPER(item_no) LIKE ? OR UPPER(market_model) LIKE ?)");
      bindings.push(pattern, pattern, pattern);
    } else {
      filters.push("(normalized_model LIKE ? OR UPPER(item_no) LIKE ? OR UPPER(description) LIKE ? OR UPPER(market_model) LIKE ?)");
      bindings.push(pattern, pattern, pattern, pattern);
    }
  }
  if (highTouch) filters.push("high_touch = 1");
  const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
  const orderBindings: unknown[] = [];
  let orderBy = "ORDER BY high_touch DESC, normalized_model";
  if (suggestionMode && query) {
    orderBy = `ORDER BY CASE
      WHEN normalized_model = ? THEN 0
      WHEN normalized_model LIKE ? THEN 1
      WHEN UPPER(item_no) = ? THEN 2
      WHEN UPPER(item_no) LIKE ? THEN 3
      ELSE 4 END, high_touch DESC, normalized_model`;
    orderBindings.push(query, `${query}%`, query, `${query}%`);
  }
  const rows = await db.prepare(`${productSelect}${where} ${orderBy} LIMIT ? OFFSET ?`)
    .bind(...bindings, ...orderBindings, limit, offset)
    .all<Omit<Product, "highTouch"> & { highTouch: number }>();
  const count = suggestionMode
    ? null
    : await db.prepare(`SELECT COUNT(*) AS count FROM products${where}`).bind(...bindings).first<{ count: number }>();
  const pricing = suggestionMode ? null : await getPricingSettings(db, false);
  const products = (rows.results ?? []).map((product) => ({
    ...product,
    highTouch: Boolean(product.highTouch),
    listPriceVnd: pricing ? calculateVndPrice(
      product.listPriceUsd, pricing.effectiveRate, pricing.bufferPercent, pricing.roundingStep,
    ) : 0,
  }));
  return {
    products,
    total: suggestionMode ? products.length : count?.count ?? 0,
  };
}

async function upsertProduct(input: Input) {
  const db = await ensureProductCatalog();
  const itemNo = textValue(input, "itemNo");
  const model = textValue(input, "model");
  if (!itemNo || !model) throw new Error("Vui lòng nhập Item No. và Model.");
  const now = new Date().toISOString();
  const currentId = textValue(input, "id");
  const values = [
    textValue(input, "productFamily"), textValue(input, "modelGroup"), textValue(input, "marketModel"),
    model, normalizeModel(model), itemNo, textValue(input, "description"), textValue(input, "countryOfOrigin"),
    numberValue(input, "listPriceUsd"), 0,
    textValue(input, "itemStatus", "ACTIVE"), textValue(input, "grossWeight"), textValue(input, "uom", "EA"),
    textValue(input, "warrantyText", "12 tháng"), input.highTouch ? 1 : 0,
    textValue(input, "priceSource", "Cập nhật thủ công"), textValue(input, "highTouchSource"), now,
  ];
  if (currentId) {
    const result = await db.prepare(`UPDATE products SET product_family = ?, model_group = ?, market_model = ?,
      model = ?, normalized_model = ?, item_no = ?, description = ?, country_of_origin = ?, list_price_usd = ?,
      list_price_vnd = ?, item_status = ?, gross_weight = ?, uom = ?, warranty_text = ?, high_touch = ?,
      price_source = ?, high_touch_source = ?, updated_at = ? WHERE id = ?`).bind(...values, currentId).run();
    if (!result.success) throw new Error("Không thể cập nhật sản phẩm.");
    return;
  }
  const id = `PRD-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  await db.prepare(`INSERT INTO products (id, product_family, model_group, market_model, model, normalized_model,
      item_no, description, country_of_origin, list_price_usd, list_price_vnd, item_status, gross_weight, uom,
      warranty_text, high_touch, price_source, high_touch_source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_no) DO UPDATE SET product_family = excluded.product_family, model_group = excluded.model_group,
      market_model = excluded.market_model, model = excluded.model, normalized_model = excluded.normalized_model,
      description = excluded.description, country_of_origin = excluded.country_of_origin,
      list_price_usd = excluded.list_price_usd, list_price_vnd = excluded.list_price_vnd,
      item_status = excluded.item_status, gross_weight = excluded.gross_weight, uom = excluded.uom,
      warranty_text = excluded.warranty_text, high_touch = excluded.high_touch,
      price_source = excluded.price_source, high_touch_source = excluded.high_touch_source, updated_at = excluded.updated_at`)
    .bind(id, ...values).run();
}

async function importPriceList(input: Input) {
  const db = await ensureProductCatalog();
  const rows = Array.isArray(input.rows) ? input.rows.filter((row): row is Input => Boolean(row) && typeof row === "object") : [];
  if (rows.length === 0) throw new Error("Không tìm thấy sản phẩm hợp lệ trong bảng giá.");
  const now = new Date().toISOString();
  const source = textValue(input, "source", "Bảng giá Fluke nhập từ Excel");
  for (let offset = 0; offset < rows.length; offset += 80) {
    const statements = rows.slice(offset, offset + 80).flatMap((row) => {
      const itemNo = textValue(row, "itemNo");
      const model = textValue(row, "model");
      if (!itemNo || !model) return [];
      return [db.prepare(`INSERT INTO products (id, product_family, model_group, market_model, model, normalized_model,
          item_no, description, country_of_origin, list_price_usd, list_price_vnd, item_status, gross_weight, uom,
          warranty_text, high_touch, price_source, high_touch_source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '', ?)
        ON CONFLICT(item_no) DO UPDATE SET product_family = excluded.product_family, model_group = excluded.model_group,
          market_model = excluded.market_model, model = excluded.model, normalized_model = excluded.normalized_model,
          description = excluded.description, country_of_origin = excluded.country_of_origin,
          list_price_usd = excluded.list_price_usd, list_price_vnd = excluded.list_price_vnd,
          item_status = excluded.item_status, gross_weight = excluded.gross_weight, uom = excluded.uom,
          warranty_text = CASE WHEN excluded.warranty_text <> '' THEN excluded.warranty_text ELSE products.warranty_text END,
          price_source = excluded.price_source, updated_at = excluded.updated_at`).bind(
        `PRD-${itemNo}`, textValue(row, "productFamily"), textValue(row, "modelGroup"), textValue(row, "marketModel"),
        model, normalizeModel(model), itemNo, textValue(row, "description"), textValue(row, "countryOfOrigin"),
        numberValue(row, "listPriceUsd"), 0,
        textValue(row, "itemStatus", "ACTIVE"), textValue(row, "grossWeight"), textValue(row, "uom", "EA"),
        textValue(row, "warrantyText"), source, now,
      )];
    });
    if (statements.length) await db.batch(statements);
  }
  return rows.length;
}

async function importHighTouch(input: Input) {
  const db = await ensureProductCatalog();
  const rows = Array.isArray(input.rows) ? input.rows.filter((row): row is Input => Boolean(row) && typeof row === "object") : [];
  if (rows.length === 0) throw new Error("Không tìm thấy Model High‑Touch hợp lệ.");
  const now = new Date().toISOString();
  const source = textValue(input, "source", "Danh sách High‑Touch nhập từ Excel");
  const existingResult = await db.prepare(`SELECT id, item_no AS itemNo, normalized_model AS normalizedModel,
      list_price_usd AS listPriceUsd FROM products`).all<{
        id: string; itemNo: string; normalizedModel: string; listPriceUsd: number;
      }>();
  const byItemNo = new Map<string, { id: string; itemNo: string; normalizedModel: string; listPriceUsd: number }>();
  const byModel = new Map<string, { id: string; itemNo: string; normalizedModel: string; listPriceUsd: number }>();
  for (const product of existingResult.results ?? []) {
    if (product.itemNo) byItemNo.set(product.itemNo.toUpperCase(), product);
    if (!product.normalizedModel) continue;
    const current = byModel.get(product.normalizedModel);
    if (!current || product.listPriceUsd > current.listPriceUsd || (current.itemNo.startsWith("HT-") && !product.itemNo.startsWith("HT-"))) {
      byModel.set(product.normalizedModel, product);
    }
  }
  let matched = 0;
  let added = 0;
  for (let offset = 0; offset < rows.length; offset += 75) {
    const statements = rows.slice(offset, offset + 75).flatMap((row) => {
      const model = textValue(row, "model");
      if (!model) return [];
      const normalizedModel = normalizeModel(model);
      const suppliedItemNo = textValue(row, "itemNo");
      const existing = (suppliedItemNo ? byItemNo.get(suppliedItemNo.toUpperCase()) : undefined) ?? byModel.get(normalizedModel);
      if (existing) {
        matched += 1;
        return [db.prepare(`UPDATE products SET high_touch = 1, high_touch_source = ?,
          product_family = CASE WHEN product_family = '' THEN ? ELSE product_family END,
          model_group = CASE WHEN model_group = '' THEN ? ELSE model_group END,
          market_model = CASE WHEN market_model = '' THEN ? ELSE market_model END,
          description = CASE WHEN description = '' THEN ? ELSE description END,
          country_of_origin = CASE WHEN country_of_origin = '' THEN ? ELSE country_of_origin END,
          updated_at = ? WHERE id = ?`).bind(
          source, textValue(row, "productFamily"), textValue(row, "modelGroup"), textValue(row, "marketModel"),
          textValue(row, "description"), textValue(row, "countryOfOrigin"), now, existing.id,
        )];
      }
      const itemNo = suppliedItemNo || `HT-${normalizedModel.replace(/[^A-Z0-9]+/g, "-")}`;
      const inserted = { id: `PRD-${itemNo}`, itemNo, normalizedModel, listPriceUsd: 0 };
      byItemNo.set(itemNo.toUpperCase(), inserted);
      byModel.set(normalizedModel, inserted);
      added += 1;
      return [db.prepare(`INSERT INTO products (id, product_family, model_group, market_model, model, normalized_model,
          item_no, description, country_of_origin, list_price_usd, list_price_vnd, item_status, gross_weight, uom,
          warranty_text, high_touch, price_source, high_touch_source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'HIGH-TOUCH', '', 'EA', '12 tháng', 1, '', ?, ?)
        ON CONFLICT(item_no) DO UPDATE SET high_touch = 1, high_touch_source = excluded.high_touch_source,
          product_family = CASE WHEN products.product_family = '' THEN excluded.product_family ELSE products.product_family END,
          model_group = CASE WHEN products.model_group = '' THEN excluded.model_group ELSE products.model_group END,
          market_model = CASE WHEN products.market_model = '' THEN excluded.market_model ELSE products.market_model END,
          model = excluded.model, normalized_model = excluded.normalized_model,
          description = CASE WHEN products.description = '' THEN excluded.description ELSE products.description END,
          country_of_origin = CASE WHEN products.country_of_origin = '' THEN excluded.country_of_origin ELSE products.country_of_origin END,
          updated_at = excluded.updated_at`).bind(
        `PRD-${itemNo}`, textValue(row, "productFamily"), textValue(row, "modelGroup"), textValue(row, "marketModel"),
        model, normalizedModel, itemNo, textValue(row, "description"), textValue(row, "countryOfOrigin"), source, now,
      )];
    });
    if (statements.length) await db.batch(statements);
  }
  const total = await db.prepare("SELECT COUNT(*) AS count FROM products WHERE high_touch = 1").first<{ count: number }>();
  return { updated: matched + added, matched, added, total: total?.count ?? matched + added };
}

export async function GET(request: Request) {
  try {
    return Response.json(await loadProducts(request));
  } catch (error) {
    console.error("Product load failed", error);
    return Response.json({ error: "Không thể tải danh mục sản phẩm." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as Input;
    const action = textValue(input, "action");
    let updated = 1;
    let details: Record<string, number> = {};
    if (action === "upsertProduct") await upsertProduct(input);
    else if (action === "importPriceList") updated = await importPriceList(input);
    else if (action === "importHighTouch") {
      const result = await importHighTouch(input);
      updated = result.updated;
      details = { matched: result.matched, added: result.added, total: result.total };
    }
    else throw new Error("Thao tác sản phẩm không hợp lệ.");
    return Response.json({ ok: true, updated, ...details });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể cập nhật sản phẩm.";
    console.error("Product mutation failed", error);
    return Response.json({ error: message }, { status: 400 });
  }
}
