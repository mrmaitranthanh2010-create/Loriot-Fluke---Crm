import { ensureDatabase, ensureProductCatalog, type CrmDatabase } from "@/db";
import {
  enrichOpportunity,
  STAGES,
  type Account,
  type Activity,
  type Contact,
  type Opportunity,
  type Quotation,
  type QuotationItem,
} from "@/lib/crm";
import { calculateVndPrice } from "@/lib/pricing";
import { getPricingSettings } from "@/lib/pricing-server";

type OpportunityRow = Omit<Opportunity, "score" | "temperature" | "probability" | "weightedValue" | "priority">;
type QuotationRow = Omit<Quotation, "items">;
type Input = Record<string, unknown>;

const textValue = (input: Input, key: string, fallback = "") => {
  const value = input[key];
  return typeof value === "string" ? value.trim() : fallback;
};

const numberValue = (input: Input, key: string, fallback = 0) => {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
};

const normalizeCustomerCode = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, "")
  .slice(0, 16);

const statusForStage = (stage: string): Opportunity["status"] =>
  stage === "Closed Won" ? "Won" : stage === "Closed Lost" ? "Lost" : "Open";

const selectOpportunities = `SELECT
  o.id,
  o.account_id AS accountId,
  a.customer_code AS customerCode,
  a.company_name AS companyName,
  a.account_type AS accountType,
  a.industry,
  a.region,
  o.contact_id AS contactId,
  c.full_name AS contactName,
  c.title,
  c.department,
  c.buying_role AS buyingRole,
  c.phone,
  c.email,
  c.zalo,
  c.preferred_channel AS preferredChannel,
  o.product_application AS productApplication,
  o.need_pain AS needPain,
  o.stage,
  o.status,
  o.estimated_value AS estimatedValue,
  o.expected_close_date AS expectedCloseDate,
  o.actual_close_date AS actualCloseDate,
  o.last_contact_date AS lastContactDate,
  o.next_step AS nextStep,
  o.next_step_due AS nextStepDue,
  o.owner,
  o.icp_fit AS icpFit,
  o.need_score AS needScore,
  o.authority_score AS authorityScore,
  o.budget_score AS budgetScore,
  o.timing_score AS timingScore,
  o.engagement_score AS engagementScore,
  o.channel_score AS channelScore,
  o.competitor,
  o.lost_reason AS lostReason,
  o.notes,
  o.end_user_company AS endUserCompany,
  o.end_user_address AS endUserAddress,
  o.end_user_industry AS endUserIndustry,
  o.end_user_contact_name AS endUserContactName,
  o.end_user_title AS endUserTitle,
  o.end_user_phone AS endUserPhone,
  o.end_user_email AS endUserEmail,
  o.end_user_notes AS endUserNotes,
  o.created_at AS createdAt,
  o.updated_at AS updatedAt
FROM opportunities o
JOIN accounts a ON a.id = o.account_id
JOIN contacts c ON c.id = o.contact_id
ORDER BY o.updated_at DESC`;

async function backfillLegacyQuotationItems(db: CrmDatabase) {
  const pricing = await getPricingSettings(db, false);
  const legacy = await db.prepare(`SELECT id, description, unit_price AS unitPrice
    FROM quotation_items WHERE product_id = '' AND description <> ''`).all<{ id: string; description: string; unitPrice: number }>();
  const statements = [];
  for (const item of legacy.results ?? []) {
    const product = await db.prepare(`SELECT id, model, description, country_of_origin AS origin,
      list_price_usd AS listPriceUsd, warranty_text AS warranty, uom
      FROM products WHERE normalized_model <> '' AND INSTR(UPPER(?), normalized_model) > 0
      ORDER BY LENGTH(normalized_model) DESC LIMIT 1`).bind(item.description).first<{
        id: string; model: string; description: string; origin: string; listPriceUsd: number; warranty: string; uom: string;
      }>();
    if (!product) continue;
    const listPrice = calculateVndPrice(
      product.listPriceUsd, pricing.effectiveRate, pricing.bufferPercent, pricing.roundingStep,
    );
    const discountPercent = listPrice > 0 && item.unitPrice <= listPrice
      ? Math.max(0, (1 - item.unitPrice / listPrice) * 100)
      : 0;
    statements.push(db.prepare(`UPDATE quotation_items SET product_id = ?, item_number = ?, description = ?,
      unit = ?, list_price = ?, discount_percent = ?, origin = ?, warranty = ? WHERE id = ?`).bind(
      product.id, product.model, product.description, product.uom || "EA", listPrice,
      discountPercent, product.origin, product.warranty || "12 tháng", item.id,
    ));
  }
  if (statements.length) await db.batch(statements);
}

async function loadData() {
  const db = await ensureProductCatalog();
  await backfillLegacyQuotationItems(db);
  const [opportunityResult, accountResult, contactResult, activityResult, quotationResult, itemResult] = await Promise.all([
    db.prepare(selectOpportunities).all<OpportunityRow>(),
    db.prepare(`SELECT id, customer_code AS customerCode, company_name AS companyName, account_type AS accountType, industry, region, website, owner, notes
      FROM accounts ORDER BY company_name`).all<Account>(),
    db.prepare(`SELECT id, account_id AS accountId, full_name AS fullName, title, department, buying_role AS buyingRole,
      phone, email, zalo, preferred_channel AS preferredChannel FROM contacts ORDER BY full_name`).all<Contact>(),
    db.prepare(`SELECT id, opportunity_id AS opportunityId, activity_date AS activityDate, activity_type AS activityType,
      contact_name AS contactName, summary, outcome, next_step AS nextStep, due_date AS dueDate, owner
      FROM activities ORDER BY activity_date DESC, created_at DESC`).all<Activity>(),
    db.prepare(`SELECT id, opportunity_id AS opportunityId, quotation_no AS quotationNo, quote_date AS quoteDate,
      expiration_date AS expirationDate, customer_id AS customerId, recipient_company AS recipientCompany,
      recipient_address AS recipientAddress, attention, recipient_email AS recipientEmail,
      shipping_method AS shippingMethod, shipping_terms AS shippingTerms, delivery_date AS deliveryDate,
      payment_terms AS paymentTerms, currency, vat_rate AS vatRate, prepared_by AS preparedBy, status, notes,
      subtotal, vat_amount AS vatAmount, total, created_at AS createdAt, updated_at AS updatedAt
      FROM quotations ORDER BY quote_date DESC, updated_at DESC`).all<QuotationRow>(),
    db.prepare(`SELECT id, quotation_id AS quotationId, line_no AS lineNo, item_number AS itemNumber,
      description, application, unit, quantity, product_id AS productId, list_price AS listPrice,
      discount_percent AS discountPercent, origin, warranty, unit_price AS unitPrice, amount
      FROM quotation_items ORDER BY quotation_id, line_no`).all<QuotationItem>(),
  ]);

  const allItems = itemResult.results ?? [];
  return {
    opportunities: (opportunityResult.results ?? []).map((row) => enrichOpportunity(row)),
    accounts: accountResult.results ?? [],
    contacts: contactResult.results ?? [],
    activities: activityResult.results ?? [],
    quotations: (quotationResult.results ?? []).map((quotation) => ({
      ...quotation,
      items: allItems.filter((item) => item.quotationId === quotation.id),
    })),
  };
}

export async function GET() {
  try {
    return Response.json(await loadData());
  } catch (error) {
    console.error("CRM load failed", error);
    return Response.json({ error: "Không thể tải dữ liệu CRM." }, { status: 500 });
  }
}

async function createOpportunity(input: Input) {
  const db = await ensureDatabase();
  const now = new Date().toISOString();
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const opportunityId = `OPP-${suffix}`;
  const stage = textValue(input, "stage", "Target Account");
  const customerCode = normalizeCustomerCode(textValue(input, "customerCode"));
  const companyName = textValue(input, "companyName");
  const contactName = textValue(input, "contactName");
  const productApplication = textValue(input, "productApplication");

  if (!customerCode || !companyName || !contactName || !productApplication) {
    throw new Error("Vui lòng nhập mã khách hàng, công ty, người liên hệ và sản phẩm/ứng dụng.");
  }

  const existingAccount = await db.prepare(`SELECT id FROM accounts WHERE customer_code = ? ORDER BY updated_at DESC LIMIT 1`)
    .bind(customerCode).first<{ id: string }>();
  const accountId = existingAccount?.id || `ACC-${suffix}`;
  const existingContact = existingAccount
    ? await db.prepare(`SELECT id FROM contacts WHERE account_id = ? AND UPPER(TRIM(full_name)) = UPPER(TRIM(?))
        ORDER BY updated_at DESC LIMIT 1`).bind(accountId, contactName).first<{ id: string }>()
    : null;
  const contactId = existingContact?.id || `CON-${suffix}`;
  const accountStatement = existingAccount
    ? db.prepare(`UPDATE accounts SET company_name = ?, account_type = ?, industry = ?, region = ?, website = ?,
        owner = ?, notes = ?, updated_at = ? WHERE id = ?`).bind(
        companyName, textValue(input, "accountType", "End-User"), textValue(input, "industry"),
        textValue(input, "region"), textValue(input, "website"), textValue(input, "owner", "Mai Trần Thành"),
        textValue(input, "accountNotes"), now, accountId,
      )
    : db.prepare(`INSERT INTO accounts (
        id, customer_code, company_name, account_type, industry, region, website, owner, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        accountId, customerCode, companyName, textValue(input, "accountType", "End-User"), textValue(input, "industry"),
        textValue(input, "region"), textValue(input, "website"), textValue(input, "owner", "Mai Trần Thành"),
        textValue(input, "accountNotes"), now, now,
      );

  const contactStatement = existingContact
    ? db.prepare(`UPDATE contacts SET title = ?, department = ?, buying_role = ?, phone = ?, email = ?, zalo = ?,
        preferred_channel = ?, updated_at = ? WHERE id = ?`).bind(
        textValue(input, "title"), textValue(input, "department"), textValue(input, "buyingRole"),
        textValue(input, "phone"), textValue(input, "email"), textValue(input, "zalo"),
        textValue(input, "preferredChannel"), now, contactId,
      )
    : db.prepare(`INSERT INTO contacts (
        id, account_id, full_name, title, department, buying_role, phone, email, zalo, preferred_channel, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        contactId, accountId, contactName, textValue(input, "title"), textValue(input, "department"),
        textValue(input, "buyingRole"), textValue(input, "phone"), textValue(input, "email"), textValue(input, "zalo"),
        textValue(input, "preferredChannel"), now, now,
      );

  const opportunityStatement = db.prepare(`INSERT INTO opportunities (
      id, account_id, contact_id, product_application, need_pain, stage, status, estimated_value,
      expected_close_date, actual_close_date, last_contact_date, next_step, next_step_due, owner,
      icp_fit, need_score, authority_score, budget_score, timing_score, engagement_score, channel_score,
      competitor, lost_reason, notes, end_user_company, end_user_address, end_user_industry,
      end_user_contact_name, end_user_title, end_user_phone, end_user_email, end_user_notes,
      stage_entered_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      opportunityId, accountId, contactId, productApplication, textValue(input, "needPain"), stage,
      statusForStage(stage), numberValue(input, "estimatedValue"), textValue(input, "expectedCloseDate"),
      stage === "Closed Won" || stage === "Closed Lost" ? now.slice(0, 10) : "", textValue(input, "lastContactDate"),
      textValue(input, "nextStep"), textValue(input, "nextStepDue"), textValue(input, "owner", "Mai Trần Thành"),
      numberValue(input, "icpFit"), numberValue(input, "needScore"), numberValue(input, "authorityScore"),
      numberValue(input, "budgetScore"), numberValue(input, "timingScore"), numberValue(input, "engagementScore"),
      numberValue(input, "channelScore"), textValue(input, "competitor"), textValue(input, "lostReason"),
      textValue(input, "notes"), textValue(input, "endUserCompany"), textValue(input, "endUserAddress"),
      textValue(input, "endUserIndustry"), textValue(input, "endUserContactName"), textValue(input, "endUserTitle"),
      textValue(input, "endUserPhone"), textValue(input, "endUserEmail"), textValue(input, "endUserNotes"),
      now, now, now,
    );

  await db.batch([accountStatement, contactStatement, opportunityStatement]);
}

async function updateOpportunity(input: Input) {
  const db = await ensureDatabase();
  const id = textValue(input, "id");
  if (!id) throw new Error("Thiếu mã cơ hội.");
  const current = await db.prepare("SELECT account_id AS accountId, contact_id AS contactId, stage, stage_entered_at AS stageEnteredAt FROM opportunities WHERE id = ?")
    .bind(id).first<{ accountId: string; contactId: string; stage: string; stageEnteredAt: string }>();
  if (!current) throw new Error("Không tìm thấy cơ hội.");

  const now = new Date().toISOString();
  const stage = textValue(input, "stage", current.stage);
  const status = statusForStage(stage);
  const actualCloseDate = status === "Open" ? "" : now.slice(0, 10);
  const customerCode = normalizeCustomerCode(textValue(input, "customerCode"));
  if (!customerCode) throw new Error("Vui lòng nhập mã khách hàng.");
  const duplicateAccount = await db.prepare(`SELECT id FROM accounts WHERE customer_code = ? AND id <> ? LIMIT 1`)
    .bind(customerCode, current.accountId).first<{ id: string }>();
  if (duplicateAccount) throw new Error("Mã khách hàng này đang thuộc một hồ sơ khác. Vui lòng kiểm tra lại.");

  const accountStatement = db.prepare(`UPDATE accounts SET customer_code = ?, company_name = ?, account_type = ?, industry = ?, region = ?,
      website = ?, owner = ?, notes = ?, updated_at = ? WHERE id = ?`).bind(
      customerCode, textValue(input, "companyName"), textValue(input, "accountType", "End-User"), textValue(input, "industry"),
      textValue(input, "region"), textValue(input, "website"), textValue(input, "owner", "Mai Trần Thành"),
      textValue(input, "accountNotes"), now, current.accountId,
    );
  const contactStatement = db.prepare(`UPDATE contacts SET full_name = ?, title = ?, department = ?, buying_role = ?,
      phone = ?, email = ?, zalo = ?, preferred_channel = ?, updated_at = ? WHERE id = ?`).bind(
      textValue(input, "contactName"), textValue(input, "title"), textValue(input, "department"),
      textValue(input, "buyingRole"), textValue(input, "phone"), textValue(input, "email"), textValue(input, "zalo"),
      textValue(input, "preferredChannel"), now, current.contactId,
    );
  const opportunityStatement = db.prepare(`UPDATE opportunities SET product_application = ?, need_pain = ?, stage = ?, status = ?,
      estimated_value = ?, expected_close_date = ?, actual_close_date = ?, last_contact_date = ?, next_step = ?, next_step_due = ?,
      owner = ?, icp_fit = ?, need_score = ?, authority_score = ?, budget_score = ?, timing_score = ?, engagement_score = ?,
      channel_score = ?, competitor = ?, lost_reason = ?, notes = ?, end_user_company = ?, end_user_address = ?,
      end_user_industry = ?, end_user_contact_name = ?, end_user_title = ?, end_user_phone = ?, end_user_email = ?,
      end_user_notes = ?, stage_entered_at = ?, updated_at = ? WHERE id = ?`).bind(
      textValue(input, "productApplication"), textValue(input, "needPain"), stage, status,
      numberValue(input, "estimatedValue"), textValue(input, "expectedCloseDate"), actualCloseDate,
      textValue(input, "lastContactDate"), textValue(input, "nextStep"), textValue(input, "nextStepDue"),
      textValue(input, "owner", "Mai Trần Thành"), numberValue(input, "icpFit"), numberValue(input, "needScore"),
      numberValue(input, "authorityScore"), numberValue(input, "budgetScore"), numberValue(input, "timingScore"),
      numberValue(input, "engagementScore"), numberValue(input, "channelScore"), textValue(input, "competitor"),
      textValue(input, "lostReason"), textValue(input, "notes"), textValue(input, "endUserCompany"),
      textValue(input, "endUserAddress"), textValue(input, "endUserIndustry"), textValue(input, "endUserContactName"),
      textValue(input, "endUserTitle"), textValue(input, "endUserPhone"), textValue(input, "endUserEmail"),
      textValue(input, "endUserNotes"), stage !== current.stage ? now : current.stageEnteredAt, now, id,
    );
  await db.batch([accountStatement, contactStatement, opportunityStatement]);
}

async function deleteQuotation(input: Input) {
  const db = await ensureDatabase();
  const id = textValue(input, "id");
  if (!id) throw new Error("Thiếu mã báo giá.");
  const current = await db.prepare("SELECT id FROM quotations WHERE id = ?").bind(id).first<{ id: string }>();
  if (!current) throw new Error("Không tìm thấy báo giá cần xóa.");
  await db.batch([
    db.prepare("DELETE FROM quotation_items WHERE quotation_id = ?").bind(id),
    db.prepare("DELETE FROM quotations WHERE id = ?").bind(id),
  ]);
}

async function deleteOpportunity(input: Input) {
  const db = await ensureDatabase();
  const id = textValue(input, "id");
  if (!id) throw new Error("Thiếu mã cơ hội.");
  const current = await db.prepare(`SELECT account_id AS accountId, contact_id AS contactId
    FROM opportunities WHERE id = ?`).bind(id).first<{ accountId: string; contactId: string }>();
  if (!current) throw new Error("Không tìm thấy cơ hội cần xóa.");
  const linked = await db.prepare("SELECT COUNT(*) AS count FROM quotations WHERE opportunity_id = ?")
    .bind(id).first<{ count: number }>();
  if ((linked?.count ?? 0) > 0) {
    throw new Error(`Cơ hội đang có ${linked?.count ?? 0} báo giá liên kết. Hãy xóa báo giá trước rồi xóa cơ hội.`);
  }
  await db.batch([
    db.prepare("DELETE FROM activities WHERE opportunity_id = ?").bind(id),
    db.prepare("DELETE FROM opportunities WHERE id = ?").bind(id),
    db.prepare(`DELETE FROM contacts WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM opportunities WHERE contact_id = ?)`).bind(current.contactId, current.contactId),
    db.prepare(`DELETE FROM accounts WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM opportunities WHERE account_id = ?)
      AND NOT EXISTS (SELECT 1 FROM contacts WHERE account_id = ?)`).bind(current.accountId, current.accountId, current.accountId),
  ]);
}

async function moveStage(input: Input) {
  const db = await ensureDatabase();
  const id = textValue(input, "id");
  const stage = textValue(input, "stage");
  if (!id || !STAGES.some((item) => item.name === stage)) throw new Error("Giai đoạn không hợp lệ.");
  const now = new Date().toISOString();
  const status = statusForStage(stage);
  await db.prepare(`UPDATE opportunities SET stage = ?, status = ?, actual_close_date = ?, stage_entered_at = ?, updated_at = ? WHERE id = ?`)
    .bind(stage, status, status === "Open" ? "" : now.slice(0, 10), now, now, id).run();
}

async function completeNextStep(input: Input) {
  const db = await ensureDatabase();
  const id = textValue(input, "id");
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const current = await db.prepare(`${selectOpportunities.replace("ORDER BY o.updated_at DESC", "WHERE o.id = ?")}`)
    .bind(id).first<OpportunityRow>();
  if (!current || !id) throw new Error("Không tìm thấy cơ hội.");

  const activityId = `ACT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const activityStatement = db.prepare(`INSERT INTO activities (
      id, opportunity_id, activity_date, activity_type, contact_name, summary, outcome, next_step, due_date, owner, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)`).bind(
      activityId, id, today, "Follow-up", current.contactName, current.nextStep || "Follow-up cơ hội",
      "Đã hoàn thành", current.owner, now.toISOString(),
    );
  const opportunityStatement = db.prepare(`UPDATE opportunities SET last_contact_date = ?, next_step = '', next_step_due = '', updated_at = ? WHERE id = ?`)
    .bind(today, now.toISOString(), id);
  await db.batch([activityStatement, opportunityStatement]);
}

async function nextQuotationNumber(quoteDate: string, rawCustomerCode: string) {
  const db = await ensureDatabase();
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(quoteDate) ? quoteDate : new Date().toISOString().slice(0, 10);
  const customerCode = normalizeCustomerCode(rawCustomerCode);
  if (!customerCode) throw new Error("Vui lòng nhập mã khách hàng trước khi tạo báo giá.");
  const result = await db.prepare(`SELECT quotation_no AS quotationNo, customer_id AS customerId FROM quotations
    WHERE TRIM(customer_id) <> ''`).all<{ quotationNo: string; customerId: string }>();
  const matching = (result.results ?? []).filter((quotation) => normalizeCustomerCode(quotation.customerId) === customerCode);
  const maxSequence = matching.reduce((max, quotation) => {
    const sequence = Number(quotation.quotationNo.match(/-(\d+)$/)?.[1] ?? 0);
    return Math.max(max, sequence);
  }, 0);
  const nextSequence = Math.max(maxSequence, matching.length) + 1;
  return `LOR${safeDate.replaceAll("-", "")}${customerCode}-${nextSequence}`;
}

async function saveQuotation(input: Input) {
  const db = await ensureDatabase();
  const opportunityId = textValue(input, "opportunityId");
  const quoteDate = textValue(input, "quoteDate", new Date().toISOString().slice(0, 10));
  const recipientCompany = textValue(input, "recipientCompany");
  const rawCurrency = textValue(input, "currency", "VND").toUpperCase();
  const currency = rawCurrency === "VNĐ" ? "VND" : rawCurrency;
  const roundMoney = (value: number) => currency === "VND" ? Math.round(value) : Math.round(value * 100) / 100;
  if (!opportunityId || !recipientCompany) throw new Error("Vui lòng chọn cơ hội và nhập công ty nhận báo giá.");

  const opportunity = await db.prepare("SELECT id, stage, status FROM opportunities WHERE id = ?")
    .bind(opportunityId).first<{ id: string; stage: string; status: string }>();
  if (!opportunity) throw new Error("Không tìm thấy cơ hội để lập báo giá.");

  const rawItems = Array.isArray(input.items) ? input.items.filter((item): item is Input => Boolean(item) && typeof item === "object") : [];
  const items = rawItems.map((item, index) => ({
    lineNo: index + 1,
    itemNumber: textValue(item, "itemNumber"),
    description: textValue(item, "description"),
    application: textValue(item, "application"),
    unit: textValue(item, "unit", "PCS"),
    quantity: Math.max(0, numberValue(item, "quantity", 1)),
    productId: textValue(item, "productId"),
    listPrice: Math.max(0, roundMoney(numberValue(item, "listPrice"))),
    discountPercent: Math.max(0, Math.min(100, numberValue(item, "discountPercent"))),
    origin: textValue(item, "origin"),
    warranty: textValue(item, "warranty", "12 tháng"),
    unitPrice: Math.max(0, roundMoney(numberValue(item, "unitPrice"))),
  })).filter((item) => item.description || item.itemNumber);
  if (items.length === 0) throw new Error("Báo giá cần ít nhất một sản phẩm.");
  if (items.some((item) => item.quantity <= 0)) throw new Error("Số lượng sản phẩm phải lớn hơn 0.");

  const vatRate = Math.max(0, Math.min(100, numberValue(input, "vatRate", 8)));
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const vatAmount = roundMoney(subtotal * vatRate / 100);
  const total = roundMoney(subtotal + vatAmount);
  const now = new Date().toISOString();
  const currentId = textValue(input, "id");
  const id = currentId || `QUO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const customerId = normalizeCustomerCode(textValue(input, "customerId"));
  const existing = currentId ? await db.prepare("SELECT id, quotation_no AS quotationNo FROM quotations WHERE id = ?")
    .bind(currentId).first<{ id: string; quotationNo: string }>() : null;
  if (currentId && !existing) throw new Error("Không tìm thấy báo giá cần cập nhật.");
  const preserveQuotationNo = input.preserveQuotationNo === true;
  const quotationNo = existing?.quotationNo || (preserveQuotationNo
    ? textValue(input, "quotationNo")
    : await nextQuotationNumber(quoteDate, customerId));
  if (!quotationNo) throw new Error("Thiếu số báo giá.");

  const values = [
    opportunityId, quotationNo, quoteDate, textValue(input, "expirationDate"), customerId,
    recipientCompany, textValue(input, "recipientAddress"), textValue(input, "attention"), textValue(input, "recipientEmail"),
    textValue(input, "shippingMethod", "Air Shipment"), textValue(input, "shippingTerms", "DDP"),
    textValue(input, "deliveryDate", "2-4 Weeks"), textValue(input, "paymentTerms", "100% TT"),
    currency, vatRate, textValue(input, "preparedBy", "MAI TRẦN THÀNH (+84 964 72 72 33)"),
    textValue(input, "status", "Draft"), textValue(input, "notes"), subtotal, vatAmount, total,
  ];

  const quoteStatement = existing
    ? db.prepare(`UPDATE quotations SET opportunity_id = ?, quotation_no = ?, quote_date = ?, expiration_date = ?,
        customer_id = ?, recipient_company = ?, recipient_address = ?, attention = ?, recipient_email = ?,
        shipping_method = ?, shipping_terms = ?, delivery_date = ?, payment_terms = ?, currency = ?, vat_rate = ?,
        prepared_by = ?, status = ?, notes = ?, subtotal = ?, vat_amount = ?, total = ?, updated_at = ? WHERE id = ?`)
      .bind(...values, now, id)
    : db.prepare(`INSERT INTO quotations (id, opportunity_id, quotation_no, quote_date, expiration_date, customer_id,
        recipient_company, recipient_address, attention, recipient_email, shipping_method, shipping_terms,
        delivery_date, payment_terms, currency, vat_rate, prepared_by, status, notes, subtotal, vat_amount, total,
        created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, ...values, now, now);

  const statements = [quoteStatement];
  if (existing) statements.push(db.prepare("DELETE FROM quotation_items WHERE quotation_id = ?").bind(id));
  for (const item of items) {
    statements.push(db.prepare(`INSERT INTO quotation_items (
      id, quotation_id, line_no, item_number, description, application, unit, quantity, product_id, list_price,
      discount_percent, origin, warranty, unit_price, amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      `QIT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, id, item.lineNo, item.itemNumber,
      item.description, item.application, item.unit, item.quantity, item.productId, item.listPrice, item.discountPercent,
      item.origin, item.warranty, item.unitPrice, roundMoney(item.quantity * item.unitPrice),
    ));
  }

  const quoteStageIndex = STAGES.findIndex((stage) => stage.name === "Quotation");
  const currentStageIndex = STAGES.findIndex((stage) => stage.name === opportunity.stage);
  if (opportunity.status === "Open" && currentStageIndex >= 0 && currentStageIndex < quoteStageIndex) {
    statements.push(db.prepare("UPDATE opportunities SET stage = 'Quotation', stage_entered_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, opportunityId));
  }
  await db.batch(statements);
}

const importedParty = (recipientCompany: string, customerId: string) => {
  const match = recipientCompany.match(/^(.*?)\s*\(\s*([^()]*)\s*\)\s*$/);
  const rawAccountCompany = (match?.[1] || recipientCompany).replace(/\s+/g, " ").trim();
  const accountCompany = rawAccountCompany.replace(/^CÔNG TY\s+CP\b/i, "CÔNG TY CỔ PHẦN");
  const endUserCompany = (match?.[2] || "").replace(/\s+/g, " ").trim();
  const accountType = endUserCompany || customerId.toUpperCase() === "MRO" ? "Trading Partner" : "Existing Customer";
  return { accountCompany, accountType, endUserCompany };
};

const importedItems = (quotation: Input) => Array.isArray(quotation.items)
  ? quotation.items.filter((item): item is Input => Boolean(item) && typeof item === "object")
  : [];

const importedSubtotalVnd = (quotation: Input, effectiveUsdRate: number) => {
  const subtotal = importedItems(quotation).reduce((sum, item) =>
    sum + Math.max(0, numberValue(item, "quantity", 1)) * Math.max(0, numberValue(item, "unitPrice")), 0);
  return Math.round(textValue(quotation, "currency", "VND").toUpperCase() === "USD" ? subtotal * effectiveUsdRate : subtotal);
};

async function opportunityForImportedQuotation(db: CrmDatabase, quotation: Input, effectiveUsdRate: number) {
  const recipientCompany = textValue(quotation, "recipientCompany");
  const party = importedParty(recipientCompany, textValue(quotation, "customerId"));
  const importNote = `Tạo tự động từ sheet ${textValue(quotation, "sheetName")}.`;
  const existingQuote = await db.prepare(`SELECT id, opportunity_id AS opportunityId
    FROM quotations WHERE quotation_no = ?`).bind(textValue(quotation, "quotationNo"))
    .first<{ id: string; opportunityId: string }>();
  if (existingQuote) return { opportunityId: existingQuote.opportunityId, quotationId: existingQuote.id, updated: true };

  const interruptedOpportunity = await db.prepare(`SELECT o.id FROM opportunities o
    JOIN accounts a ON a.id = o.account_id
    WHERE o.notes = ? AND UPPER(TRIM(a.company_name)) = UPPER(TRIM(?))
      AND NOT EXISTS (SELECT 1 FROM quotations q WHERE q.opportunity_id = o.id)
    ORDER BY o.updated_at DESC LIMIT 1`).bind(importNote, party.accountCompany).first<{ id: string }>();
  if (interruptedOpportunity) {
    return { opportunityId: interruptedOpportunity.id, quotationId: "", updated: false };
  }

  const now = new Date().toISOString();
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const importedCustomerCode = normalizeCustomerCode(textValue(quotation, "customerId"));
  const existingAccount = await db.prepare(`SELECT id, customer_code AS customerCode FROM accounts
    WHERE UPPER(TRIM(company_name)) = UPPER(TRIM(?)) LIMIT 1`).bind(party.accountCompany).first<{ id: string; customerCode: string }>();
  const accountId = existingAccount?.id || `ACC-${suffix}`;
  const attention = textValue(quotation, "attention", "Chưa xác định");
  const existingContact = existingAccount
    ? await db.prepare(`SELECT id FROM contacts WHERE account_id = ?
      AND UPPER(TRIM(full_name)) = UPPER(TRIM(?)) ORDER BY updated_at DESC LIMIT 1`)
      .bind(accountId, attention).first<{ id: string }>()
    : null;
  const contactId = existingContact?.id || `CON-${suffix}`;
  const opportunityId = `OPP-${suffix}`;
  const rawItems = importedItems(quotation);
  const productApplication = rawItems.map((item) => textValue(item, "application") || textValue(item, "description"))
    .filter(Boolean).join("; ").slice(0, 500) || `Báo giá ${textValue(quotation, "quotationNo")}`;
  const primaryItemNumber = rawItems.map((item) => textValue(item, "itemNumber")).find(Boolean) || "";
  const matchingOpportunity = existingAccount && existingContact && primaryItemNumber
    ? await db.prepare(`SELECT o.id FROM opportunities o
      JOIN quotations q ON q.opportunity_id = o.id
      JOIN quotation_items qi ON qi.quotation_id = q.id
      WHERE o.account_id = ? AND o.contact_id = ? AND o.status = 'Open'
        AND UPPER(TRIM(qi.item_number)) = UPPER(TRIM(?))
      ORDER BY o.updated_at DESC LIMIT 1`).bind(accountId, contactId, primaryItemNumber).first<{ id: string }>()
    : null;
  if (matchingOpportunity) {
    return { opportunityId: matchingOpportunity.id, quotationId: "", updated: false };
  }
  const estimatedValue = importedSubtotalVnd(quotation, effectiveUsdRate);
  const recipientEmail = textValue(quotation, "recipientEmail");
  const contactEmail = /@loriot\.com\.vn$/i.test(recipientEmail) ? "" : recipientEmail;
  const statements = [];
  if (!existingAccount) {
    statements.push(db.prepare(`INSERT INTO accounts (
      id, customer_code, company_name, account_type, industry, region, website, owner, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', ?, '', 'Mai Trần Thành', ?, ?, ?)`).bind(
      accountId, importedCustomerCode, party.accountCompany, party.accountType, textValue(quotation, "recipientAddress"),
      `Tạo tự động khi nhập báo giá ${textValue(quotation, "quotationNo")}.`, now, now,
    ));
  } else if (!existingAccount.customerCode && importedCustomerCode) {
    statements.push(db.prepare("UPDATE accounts SET customer_code = ?, updated_at = ? WHERE id = ?")
      .bind(importedCustomerCode, now, accountId));
  }
  if (!existingContact) {
    statements.push(db.prepare(`INSERT INTO contacts (
      id, account_id, full_name, title, department, buying_role, phone, email, zalo, preferred_channel, created_at, updated_at
    ) VALUES (?, ?, ?, '', '', 'Contact', '', ?, '', 'Email', ?, ?)`).bind(
      contactId, accountId, attention, contactEmail, now, now,
    ));
  }
  statements.push(db.prepare(`INSERT INTO opportunities (
    id, account_id, contact_id, product_application, need_pain, stage, status, estimated_value,
    expected_close_date, actual_close_date, last_contact_date, next_step, next_step_due, owner,
    icp_fit, need_score, authority_score, budget_score, timing_score, engagement_score, channel_score,
    competitor, lost_reason, notes, end_user_company, end_user_address, end_user_industry,
    end_user_contact_name, end_user_title, end_user_phone, end_user_email, end_user_notes,
    stage_entered_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, '', 'Quotation', 'Open', ?, ?, '', ?, 'Xác nhận trạng thái báo giá nhập từ Excel', ?,
    'Mai Trần Thành', 4, 5, 3, 4, 4, 4, 4, '', '', ?, ?, '', '', '', '', '', '', ?, ?, ?, ?)`).bind(
    opportunityId, accountId, contactId, productApplication, estimatedValue,
    textValue(quotation, "expirationDate"), textValue(quotation, "quoteDate"), textValue(quotation, "expirationDate"),
    importNote, party.endUserCompany,
    party.endUserCompany ? "End-User được tách từ tên công ty trên báo giá." : "", now, now, now,
  ));
  await db.batch(statements);
  return { opportunityId, quotationId: "", updated: false };
}

async function importQuotations(input: Input) {
  const raw = Array.isArray(input.quotations)
    ? input.quotations.filter((item): item is Input => Boolean(item) && typeof item === "object")
    : [];
  if (!raw.length) throw new Error("File không có báo giá hợp lệ để nhập.");
  if (raw.length > 100) throw new Error("Mỗi lần chỉ nhập tối đa 100 sheet báo giá.");
  const db = await ensureProductCatalog();
  const pricing = await getPricingSettings(db, false);
  let inserted = 0;
  let updated = 0;
  for (const quotation of raw) {
    const quotationNo = textValue(quotation, "quotationNo");
    const recipientCompany = textValue(quotation, "recipientCompany");
    if (!quotationNo || !recipientCompany) throw new Error("Mỗi sheet cần có số báo giá và công ty nhận báo giá.");
    const linked = await opportunityForImportedQuotation(db, quotation, pricing.effectiveRate);
    await saveQuotation({
      ...quotation,
      id: linked.quotationId,
      opportunityId: linked.opportunityId,
      status: textValue(quotation, "status", "Sent"),
      preserveQuotationNo: true,
    });
    if (linked.updated) updated += 1;
    else inserted += 1;
  }
  return { inserted, updated, total: raw.length };
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as Input;
    const action = textValue(input, "action");
    let importSummary: { inserted: number; updated: number; total: number } | undefined;
    if (action === "create") await createOpportunity(input);
    else if (action === "update") await updateOpportunity(input);
    else if (action === "deleteOpportunity") await deleteOpportunity(input);
    else if (action === "moveStage") await moveStage(input);
    else if (action === "completeNextStep") await completeNextStep(input);
    else if (action === "saveQuotation") await saveQuotation(input);
    else if (action === "deleteQuotation") await deleteQuotation(input);
    else if (action === "importQuotations") importSummary = await importQuotations(input);
    else throw new Error("Thao tác không hợp lệ.");
    return Response.json({ ...await loadData(), ...(importSummary ? { importSummary } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể lưu thay đổi.";
    console.error("CRM mutation failed", error);
    return Response.json({ error: message }, { status: 400 });
  }
}
