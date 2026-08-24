import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

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
  const [client, schema, quotationExport, template, templateBytes] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/quotation-xlsx.ts", import.meta.url), "utf8"),
    stat(new URL("../public/quotation-template.xlsx", import.meta.url)),
    readFile(new URL("../public/quotation-template.xlsx", import.meta.url)),
  ]);
  assert.match(client, /End-User cuối cùng/);
  assert.match(client, /Lưu & xuất Excel/);
  assert.match(client, /generateQuotationXlsx/);
  assert.match(schema, /endUserCompany/);
  assert.match(schema, /quotationItems/);
  assert.match(quotationExport, /const englishMonthNames = \["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"\]/);
  assert.match(quotationExport, /\["G7", formatExpirationDate\(quotation\.expirationDate\)\]/);
  assert.ok(template.size > 50_000);

  const templateFiles = unzipSync(new Uint8Array(templateBytes));
  const worksheetPath = Object.keys(templateFiles).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  assert.ok(worksheetPath);
  const worksheetXml = strFromU8(templateFiles[worksheetPath]);
  const stylesXml = strFromU8(templateFiles["xl/styles.xml"]);
  assert.match(worksheetXml, /<x:mergeCell ref="B4:C4"\s*\/>/);
  assert.match(worksheetXml, /<x:mergeCell ref="D4:F4"\s*\/>/);
  assert.doesNotMatch(worksheetXml, /<x:mergeCell ref="B4:D4"\s*\/>/);
  assert.match(worksheetXml, /<x:c r="D4"[^>]*>[\s\S]*?<x:v>QUOTATION NO\.<\/x:v>[\s\S]*?<\/x:c>/);

  const styleFont = (cellReference) => {
    const styleId = Number(worksheetXml.match(new RegExp(`<x:c\\b(?=[^>]*\\br="${cellReference}")[^>]*\\bs="(\\d+)"`))?.[1]);
    const fontsXml = stylesXml.match(/<x:fonts\b[^>]*>([\s\S]*?)<\/x:fonts>/)?.[1] ?? "";
    const cellXfsXml = stylesXml.match(/<x:cellXfs\b[^>]*>([\s\S]*?)<\/x:cellXfs>/)?.[1] ?? "";
    const fonts = fontsXml.match(/<x:font\b[^>]*>[\s\S]*?<\/x:font>/g) ?? [];
    const cellXfs = cellXfsXml.match(/<x:xf\b[^>]*?(?:\/>|>[\s\S]*?<\/x:xf>)/g) ?? [];
    const fontId = Number(cellXfs[styleId]?.match(/\bfontId="(\d+)"/)?.[1]);
    const fontXml = fonts[fontId] ?? "";
    return {
      size: Number(fontXml.match(/<x:sz\b[^>]*\bval="([^"]+)"/)?.[1]),
      italic: /<x:i\b[^>]*\/>/.test(fontXml),
    };
  };
  assert.deepEqual(styleFont("B3"), { size: 9, italic: false });
  assert.deepEqual(styleFont("B4"), { size: 8.5, italic: false });
  assert.deepEqual(styleFont("B5"), { size: 8.5, italic: false });
  assert.deepEqual(styleFont("D4"), { size: 10, italic: false });

  const expirationStyleId = Number(worksheetXml.match(/<x:c\b(?=[^>]*\br="G7")[^>]*\bs="(\d+)"/)?.[1]);
  const cellXfsXml = stylesXml.match(/<x:cellXfs\b[^>]*>([\s\S]*?)<\/x:cellXfs>/)?.[1] ?? "";
  const cellXfs = cellXfsXml.match(/<x:xf\b[^>]*?(?:\/>|>[\s\S]*?<\/x:xf>)/g) ?? [];
  const expirationNumFmtId = cellXfs[expirationStyleId]?.match(/\bnumFmtId="(\d+)"/)?.[1];
  const expirationNumberFormat = stylesXml.match(new RegExp(`<x:numFmt\\b(?=[^>]*\\bnumFmtId="${expirationNumFmtId}")[^>]*\\bformatCode="([^"]+)"`))?.[1];
  assert.equal(expirationNumberFormat, "[$-409]dd\\-mmm\\-yyyy;@");
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
  const [operations, styles, weeklyExport, weeklyApi, quotationExport] = await Promise.all([
    readFile(new URL("../app/operations-views.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/weekly-report-xlsx.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/weekly-reports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/quotation-xlsx.ts", import.meta.url), "utf8"),
  ]);
  assert.match(operations, /weekly-day-number/);
  assert.match(operations, /Thứ tự này được giữ nguyên khi xuất Excel/);
  assert.match(operations, /Quy tắc lấy dữ liệu/);
  assert.match(operations, /includeInWeeklyReport/);
  assert.match(styles, /\.weekly-plan-grid \{ display: grid; grid-template-columns: 1fr/);
  assert.match(styles, /grid-template-columns: 150px minmax\(260px, 1\.25fr\) minmax\(300px, \.85fr\)/);
  assert.match(weeklyExport, /report\.plan\.slice\(0, 5\)\.forEach/);
  assert.match(operations, /companyWeekNumber\(report\.weekStart\)/);
  assert.match(weeklyApi, /correctLegacyWeekNumber/);
  assert.match(quotationExport, /fitToWidth="1" fitToHeight="1"/);
  assert.match(quotationExport, /quotationRowHeight/);
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
  assert.match(operations, /Cập nhật Follow-up trong CRM/);
  assert.match(operations, /projectName: opportunity\.productApplication/);
});

test("separates outbound leads and reports only selected follow-up history", async () => {
  const [client, leadView, followUp, operations, crmApi, database, schema] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lead-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/follow-up-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-views.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/crm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /label: "Lead & Email"/);
  assert.match(client, /fromLeadToOpportunity/);
  assert.match(client, /sourceLeadId/);
  assert.match(leadView, /Email tìm kiếm hàng loạt không tự tạo cơ hội/);
  assert.match(leadView, /Chuyển cơ hội/);
  assert.match(followUp, /Nhật ký Follow-up & Next Step/);
  assert.match(followUp, /Đưa vào báo cáo tuần/);
  assert.match(crmApi, /action === "saveLead"/);
  assert.match(crmApi, /action === "saveActivity"/);
  assert.match(crmApi, /converted_opportunity_id/);
  assert.match(database, /prospecting_leads/);
  assert.match(database, /include_in_weekly_report/);
  assert.match(schema, /prospectingLeads/);
  assert.match(operations, /activity\.includeInWeeklyReport/);
  assert.doesNotMatch(operations, /opportunities\.filter\(\(item\) => item\.status === "Open"\)\.slice\(0, 6\)/);
  assert.match(operations, /Mở lại chỉnh sửa/);
  assert.match(operations, /const locked = report\.status === "Submitted"/);
});

test("connects the company mailbox and records personalized Lead outreach", async () => {
  const [panel, emailApi, emailServer, emailBranding, database] = await Promise.all([
    readFile(new URL("../app/email-outreach-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/email/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/email-server.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/email-branding.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /Soạn email cho Lead/);
  assert.match(panel, /Mỗi Lead nhận một email riêng đã cá nhân hóa/);
  assert.match(panel, /Kiểm tra phản hồi/);
  assert.match(panel, /CHỮ KÝ TỰ ĐỘNG/);
  assert.match(panel, /Vui lòng nhập mật khẩu email ở lần kết nối đầu tiên/);
  assert.match(panel, /email-settings-error/);
  assert.match(panel, /type="submit" className="primary-button"/);
  assert.match(emailApi, /slice\(0, 10\)/);
  assert.match(emailApi, /status = CASE WHEN converted_opportunity_id/);
  assert.match(emailApi, /action === "syncReplies"/);
  assert.match(emailServer, /AES-GCM/);
  assert.match(emailServer, /secureTransport: settings\.smtpSecurity === "starttls"/);
  assert.match(emailServer, /multipart\/related/);
  assert.match(emailServer, /Content-ID: </);
  assert.match(emailBranding, /Mai Trần Thành \(Mr\.\)/);
  assert.match(emailBranding, /hn\.sales3@loriot\.com\.vn/);
  assert.match(emailBranding, /loriot-logo\.png/);
  assert.doesNotMatch(emailApi, /Trân trọng,\nMai Trần Thành\nLoriot Industrial/);
  assert.doesNotMatch(emailApi, /passwordCiphertext.*Response\.json/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS email_messages/);
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
