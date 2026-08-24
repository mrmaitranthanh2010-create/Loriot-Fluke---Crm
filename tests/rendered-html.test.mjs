import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const authorization = `Basic ${Buffer.from("mai:test-password").toString("base64")}`;
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", authorization } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      CRM_AUTH_USERNAME: "mai",
      CRM_AUTH_PASSWORD: "test-password",
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the branded Loriot CRM loading shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<html lang="vi">/i);
  assert.match(html, /<title>Loriot CRM \| Mai Trần Thành<\/title>/i);
  assert.match(html, /Đang mở Loriot CRM/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("ships End-User tracking and the clean quotation template", async () => {
  const [client, schema, template] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    stat(new URL("../public/quotation-template.xlsx", import.meta.url)),
  ]);
  assert.match(client, /End-User cuối cùng/);
  assert.match(client, /Lưu & xuất Excel/);
  assert.match(client, /generateQuotationXlsx/);
  assert.match(schema, /endUserCompany/);
  assert.match(schema, /quotationItems/);
  assert.ok(template.size > 50_000);
});

test("ships manual final pricing, inventory, and weekly reporting", async () => {
  const [client, operations, database, weeklyTemplate] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-views.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    stat(new URL("../public/weekly-report-template.xlsx", import.meta.url)),
  ]);
  assert.match(client, /Giá chốt/);
  assert.match(client, /setUnitPrice/);
  assert.match(client, /InventoryView/);
  assert.match(client, /WeeklyReportsView/);
  assert.match(operations, /Cập nhật file tồn kho/);
  assert.match(operations, /Hoàn thành báo cáo/);
  assert.match(operations, /generateWeeklyReportXlsx/);
  assert.match(database, /inventory_items/);
  assert.match(database, /weekly_reports/);
  assert.ok(weeklyTemplate.size > 10_000);
});

test("accepts exact monetary values and formats editable money fields", async () => {
  const client = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
  assert.match(client, /function MoneyInput/);
  assert.match(client, /new Intl\.NumberFormat\(decimals === 0 \? "vi-VN" : "en-US"/);
  assert.match(client, /placeholder="180\.000\.000"/);
  assert.doesNotMatch(client, /step="1000000"/);
  assert.doesNotMatch(client, /step="1000" value=\{item\.(?:listPrice|unitPrice)/);
});

test("allows guarded deletion of quotations and CRM opportunities", async () => {
  const [client, crmApi] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/crm/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /window\.confirm/);
  assert.match(client, /action: "deleteQuotation"/);
  assert.match(client, /action: "deleteOpportunity"/);
  assert.match(crmApi, /DELETE FROM quotation_items WHERE quotation_id/);
  assert.match(crmApi, /Hãy xóa báo giá trước rồi xóa cơ hội/);
  assert.match(crmApi, /DELETE FROM activities WHERE opportunity_id/);
});

test("numbers CRM worklists and reuses matching imported opportunities", async () => {
  const [client, crmApi] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/crm/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /<span>STT<\/span><span>Ưu tiên/);
  assert.match(client, /<th className="stt-column">STT<\/th><th>Trading Partner/);
  assert.match(client, /<th className="stt-column">STT<\/th><th>Số báo giá/);
  assert.match(crmApi, /const matchingOpportunity/);
  assert.match(crmApi, /UPPER\(TRIM\(qi\.item_number\)\) = UPPER\(TRIM\(\?\)\)/);
});

test("simplifies pipeline groups and separates quotation save actions", async () => {
  const client = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
  assert.match(client, /const PIPELINE_GROUPS/);
  assert.match(client, /label: "Tiếp cận"/);
  assert.match(client, /label: "Nhu cầu và giải pháp"/);
  assert.match(client, /label: "Báo giá"/);
  assert.match(client, /label: "Đàm phán"/);
  assert.match(client, /label: "Nuôi dưỡng"/);
  assert.match(client, /label: "Đóng dự án"/);
  assert.match(client, /Kết quả dự án/);
  assert.match(client, /value="save"/);
  assert.match(client, /value="save-export"/);
  assert.match(client, /Lưu & xuất Excel/);
});

test("creates structured opportunity products and converts an opportunity to a fresh quotation", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(client, /type OpportunityProductLine/);
  assert.match(client, /formatOpportunityProductLines/);
  assert.match(client, /Chọn Model để tự điền mô tả và giá/);
  assert.match(client, /Thêm dòng/);
  assert.match(client, /value="save-quote"/);
  assert.match(client, /Lưu & chuyển sang báo giá/);
  assert.match(client, /listPrice: 0/);
  assert.match(client, /unitPrice: 0/);
  assert.match(client, /autoComplete="off"/);
  assert.match(client, /product\.listPriceVnd/);
  assert.match(client, /line\.quantity\) \* line\.listPrice/);
  assert.match(client, /Gõ Model để xem gợi ý/);
  assert.doesNotMatch(client, /query\.length < 2/);
  assert.match(styles, /quote-item-row > button:hover:not\(:disabled\)/);
  assert.match(styles, /product-picker-menu button:hover/);
});

test("keeps Model suggestions responsive with shared caching and lightweight server search", async () => {
  const [client, productsApi, database] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/products/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /PRODUCT_SUGGESTION_CACHE/);
  assert.match(client, /PRODUCT_SUGGESTION_REQUESTS/);
  assert.match(client, /cachedProductSuggestions/);
  assert.match(client, /requestProductSuggestions/);
  assert.match(client, /pricing \? calculateVndPrice/);
  assert.match(client, /mode=suggest/);
  assert.match(client, /if \(!query\) \{/);
  assert.match(productsApi, /const suggestionMode/);
  assert.match(productsApi, /suggestionMode \? null : await getPricingSettings/);
  assert.match(productsApi, /suggestionMode \? products\.length/);
  assert.match(productsApi, /WHEN normalized_model = \? THEN 0/);
  assert.match(database, /let databaseReady: Promise<CrmDatabase> \| null = null/);
  assert.match(database, /let productCatalogReady: Promise<CrmDatabase> \| null = null/);
});

test("repairs legacy opportunity product rows and removes duplicated quote metadata", async () => {
  const client = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
  assert.match(client, /const stripLegacyQuoteMetadata/);
  assert.match(client, /\(\?:maker\|origin\|warranty\|bảo hành\)/);
  assert.match(client, /const looksLikeLegacyModel/);
  assert.match(client, /model: legacyModel/);
  assert.match(client, /description: stripLegacyQuoteMetadata\(line\.slice\(legacyCommaIndex \+ 1\)\)/);
  assert.match(client, /filter\(\(line\): line is OpportunityProductLine => Boolean\(line\)\)/);
});

test("uses branded create headers, warm hover states, and exact money totals", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(client, /const compactMoney = \(value: number\) => money\(value\)/);
  assert.match(client, /Tổng giá trị dự kiến × xác suất từng giai đoạn/);
  assert.match(client, /quotation-modal \$\{draft\.id \? "is-edit" : "is-create"\}/);
  assert.match(client, /opportunity-modal \$\{draft\.id \? "is-edit" : "is-create"\}/);
  assert.match(styles, /modal\.is-create \.modal-header::before/);
  assert.match(styles, /tbody tr:hover \{ background: #fffaf0/);
  assert.match(styles, /pipeline-card footer button:hover:not\(:disabled\) \{ background: #f5e8c8/);
});

test("brands all nine page headers and carries customer codes into sequential quotation numbers", async () => {
  const [client, crmApi, schema, styles] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/crm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(styles, /\.page-header \{ min-height: 154px/);
  assert.match(styles, /linear-gradient\(128deg, #fffef9 0%, #fff8e8 54%, #f7efd9 100%\)/);
  assert.match(styles, /\.page-header::before/);
  assert.match(client, /customerCode: string/);
  assert.match(client, /function CustomerCodePicker/);
  assert.match(client, /Gõ mã hoặc tên công ty/);
  assert.match(client, /contacts\.find\(\(item\) => item\.accountId === account\.id\)/);
  assert.match(client, /customerId: customerCode/);
  assert.match(client, /`LOR\$\{date\.replaceAll\("-", ""\)\}\$\{customerCode \|\| "KHACH"\}-\$\{nextSequence\}`/);
  assert.match(client, /<input required readOnly className="readonly-identity" value=\{draft\.quotationNo\}/);
  assert.match(crmApi, /nextQuotationNumber\(quoteDate, customerId\)/);
  assert.match(crmApi, /Math\.max\(maxSequence, matching\.length\) \+ 1/);
  assert.match(schema, /customerCode: text\("customer_code"\)/);
});

test("opens a fresh quotation choice and reuses saved customer details without duplicate contacts", async () => {
  const [client, crmApi, styles] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/crm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(client, /const \[selectedId, setSelectedId\] = useState\(""\)/);
  assert.match(client, /const \[quoteSearch, setQuoteSearch\] = useState\(""\)/);
  assert.match(client, /function OpportunitySearchPicker/);
  assert.match(client, /Gõ mã khách hàng, tên công ty, End‑User hoặc Model/);
  assert.match(client, /normalizeSearchText/);
  assert.match(client, /const searchIndex = useMemo/);
  assert.match(client, /filteredQuotations/);
  assert.match(client, /Gõ số báo giá, khách hàng, End-User hoặc Model/);
  assert.match(client, /quote\.items\.flatMap/);
  assert.match(client, /item\.productApplication/);
  assert.match(client, /onCreate\(item\); setSelectedId\(""\)/);
  assert.match(client, /Chọn cơ hội trước/);
  assert.match(client, /quote-selection-note/);
  assert.match(client, /companyName: account\.companyName/);
  assert.match(client, /contactName: contact\?\.fullName/);
  assert.match(client, /const changeCustomerCode/);
  assert.match(client, /companyName: ""/);
  assert.match(crmApi, /SELECT id FROM contacts WHERE account_id = \? AND UPPER\(TRIM\(full_name\)\)/);
  assert.match(styles, /\.customer-code-menu/);
  assert.match(styles, /\.opportunity-search-menu/);
  assert.match(styles, /\.quotation-filter \.filter-search/);
});

test("cancels stale product and inventory searches while typing", async () => {
  const [client, operations] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-views.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(client, /signal: controller\.signal/);
  assert.match(client, /controller\.abort\(\)/);
  assert.match(client, /\}, 80\);/);
  assert.match(operations, /async \(signal\?: AbortSignal\)/);
  assert.match(operations, /load\(controller\.signal\), 80/);
  assert.match(operations, /error instanceof DOMException && error\.name === "AbortError"/);
});

test("turns the notification bell into an urgent-work center", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(client, /const \[notificationOpen, setNotificationOpen\]/);
  assert.match(client, /const notificationRef = useRef<HTMLDivElement>/);
  assert.match(client, /urgentNotifications/);
  assert.match(client, /aria-haspopup="dialog"/);
  assert.match(client, /Xem tất cả việc cần làm/);
  assert.match(client, /openEdit\(item\)/);
  assert.match(styles, /\.notification-panel/);
  assert.match(styles, /\.notification-item:hover/);
});

test("protects the Cloudflare Worker and every CRM API behind a password", async () => {
  const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const viteSource = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

  assert.match(workerSource, /CRM_AUTH_PASSWORD/);
  assert.match(workerSource, /WWW-Authenticate/);
  assert.match(workerSource, /constantTimeEqual/);
  assert.match(workerSource, /isPublicStaticAsset/);
  assert.match(
    await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    /"run_worker_first"\s*:\s*\["\/\*",\s*"!\/_next\/static\/\*",\s*"!\/favicon\.svg"\]/,
  );
  assert.match(workerSource, /\/_next\/static\//);
  assert.match(viteSource, /CRM_AUTH_USERNAME:\s*"mai"/);
});

test("lays out the Monday-to-Friday plan vertically while preserving the Excel plan order", async () => {
  const [operations, styles, weeklyExport] = await Promise.all([
    readFile(new URL("../app/operations-views.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/weekly-report-xlsx.ts", import.meta.url), "utf8"),
  ]);
  assert.match(operations, /weekly-day-number/);
  assert.match(operations, /Thứ tự này được giữ nguyên khi xuất Excel/);
  assert.match(operations, /Hành động lấy từ CRM/);
  assert.match(operations, /Activity hoàn thành trong tuần/);
  assert.match(styles, /\.weekly-plan-grid \{ display: grid; grid-template-columns: 1fr/);
  assert.match(styles, /grid-template-columns: 150px minmax\(260px, 1\.25fr\) minmax\(300px, \.85fr\)/);
  assert.match(weeklyExport, /report\.plan\.slice\(0, 5\)\.forEach/);
});

test("links CRM product applications to quotations and weekly descriptions", async () => {
  const [client, operations, schema, quotationExport] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-views.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/quotation-xlsx.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /Ứng dụng tự lấy từ CRM/);
  assert.match(client, /application: line\.description/);
  assert.match(schema, /application: text\("application"\)/);
  assert.match(quotationExport, /Application: \$\{application\}/);
  assert.match(operations, /Cập nhật hành động trong CRM/);
  assert.match(operations, /projectName: opportunity\.productApplication/);
});

test("merges High-Touch updates and tracks accepted customer revenue", async () => {
  const [client, productsApi, database] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/products/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /Doanh số cộng dồn theo khách hàng/);
  assert.match(client, /quotation\.status !== "Accepted"/);
  assert.match(client, /Mai Trần Thành/);
  assert.match(productsApi, /const existingResult/);
  assert.match(productsApi, /matched \+= 1/);
  assert.match(productsApi, /added \+= 1/);
  assert.doesNotMatch(productsApi, /UPDATE products SET high_touch = 0/);
  assert.match(database, /WHERE owner = 'Sales Fluke'/);
});

test("imports one quotation per sheet and removes only seeded demo CRM records", async () => {
  const [client, quotationParser, crmApi, database] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/product-xlsx.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/crm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /Nhập Excel nhiều sheet/);
  assert.match(client, /parseQuotationWorkbookXlsx/);
  assert.match(quotationParser, /sheetCount: sheets\.length, quotations/);
  assert.match(quotationParser, /status: "Sent"/);
  assert.match(quotationParser, /Date\.UTC\(1899, 11, 30\)/);
  assert.match(crmApi, /action === "importQuotations"/);
  assert.match(crmApi, /WHERE quotation_no = \?/);
  assert.match(crmApi, /const importedParty/);
  assert.match(crmApi, /endUserCompany/);
  assert.match(crmApi, /interruptedOpportunity/);
  assert.match(client, /quoteMoney/);
  assert.match(client, /Tổng giá trị theo tiền tệ/);
  assert.match(database, /DELETE FROM opportunities WHERE id LIKE 'DEMO-%'/);
  assert.doesNotMatch(database, /SEED_OPPORTUNITIES/);
});
