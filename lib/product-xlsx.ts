import { strFromU8, unzipSync } from "fflate";
import { emptyWeeklyReport, type WeeklyProjectItem, type WeeklyReport } from "@/lib/operations";

export type ImportedProduct = {
  productFamily: string;
  modelGroup: string;
  marketModel: string;
  model: string;
  itemNo: string;
  description: string;
  countryOfOrigin: string;
  listPriceUsd: number;
  listPriceVnd: number;
  itemStatus: string;
  grossWeight: string;
  uom: string;
  warrantyText: string;
};

export type ImportedHighTouch = Pick<ImportedProduct,
  "productFamily" | "modelGroup" | "marketModel" | "model" | "itemNo" | "description" | "countryOfOrigin"
>;

type WorkbookSheet = { name: string; rows: string[][] };

export type ImportedInventoryItem = {
  materialCode: string;
  itemNo: string;
  description: string;
  unit: string;
  quantity: number;
};

export type ImportedQuotationItem = {
  itemNumber: string;
  description: string;
  application: string;
  unit: string;
  quantity: number;
  listPrice: number;
  discountPercent: number;
  origin: string;
  warranty: string;
  unitPrice: number;
};

export type ImportedQuotation = {
  sheetName: string;
  quotationNo: string;
  quoteDate: string;
  expirationDate: string;
  customerId: string;
  recipientCompany: string;
  recipientAddress: string;
  attention: string;
  recipientEmail: string;
  shippingMethod: string;
  shippingTerms: string;
  deliveryDate: string;
  paymentTerms: string;
  currency: string;
  vatRate: number;
  preparedBy: string;
  status: "Sent";
  notes: string;
  items: ImportedQuotationItem[];
};

export type ImportedTargetLead = {
  id: string;
  companyName: string;
  website: string;
  industry: string;
  accountType: "End-User";
  contactName: string;
  title: string;
  email: string;
  phone: string;
  source: string;
  notes: string;
  owner: "Mai Trần Thành";
};

const text = (value: unknown) => String(value ?? "").trim();
const normalizeHeader = (value: unknown) => text(value).toUpperCase().replace(/\s+/g, " ");
const number = (value: unknown) => {
  const parsed = Number(text(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const elements = (document: Document | Element, localName: string) =>
  Array.from(document.getElementsByTagNameNS("*", localName));

const parseXml = (value: string) => {
  const document = new DOMParser().parseFromString(value, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("File Excel có XML không hợp lệ.");
  return document;
};

const columnIndex = (reference: string) => {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const workbookSheets = (bytes: Uint8Array): WorkbookSheet[] => {
  const files = unzipSync(bytes);
  const read = (path: string) => files[path] ? strFromU8(files[path]) : "";
  const workbookDocument = parseXml(read("xl/workbook.xml"));
  const relationshipsDocument = parseXml(read("xl/_rels/workbook.xml.rels"));
  const targets = new Map(elements(relationshipsDocument, "Relationship").map((relationship) => [
    relationship.getAttribute("Id") ?? "",
    relationship.getAttribute("Target") ?? "",
  ]));
  const sharedStringsDocument = read("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsDocument
    ? elements(parseXml(sharedStringsDocument), "si").map((item) => elements(item, "t").map((node) => node.textContent ?? "").join(""))
    : [];

  return elements(workbookDocument, "sheet").flatMap((sheet) => {
    const name = sheet.getAttribute("name") ?? "Sheet";
    const relationshipId = sheet.getAttribute("r:id")
      ?? sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")
      ?? "";
    const target = targets.get(relationshipId);
    if (!target) return [];
    const path = target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : `xl/${target.replace(/^\.\//, "")}`;
    const xml = read(path);
    if (!xml) return [];
    const document = parseXml(xml);
    const rows = elements(document, "row").map((row) => {
      const values: string[] = [];
      for (const cell of elements(row, "c")) {
        const index = columnIndex(cell.getAttribute("r") ?? "A1");
        const type = cell.getAttribute("t") ?? "";
        const raw = elements(cell, "v")[0]?.textContent ?? "";
        const value = type === "s"
          ? sharedStrings[Number(raw)] ?? ""
          : type === "inlineStr"
            ? elements(cell, "t").map((node) => node.textContent ?? "").join("")
            : raw;
        values[index] = value;
      }
      return values;
    });
    return [{ name, rows }];
  });
};

const headerMap = (headers: string[]) => new Map(headers.map((header, index) => [normalizeHeader(header), index]));
const findIndex = (headers: Map<string, number>, test: (header: string) => boolean) =>
  [...headers].find(([header]) => test(header))?.[1] ?? -1;
const get = (row: string[], index: number) => index >= 0 ? text(row[index]) : "";

export function parsePriceListXlsx(bytes: Uint8Array) {
  const sheets = workbookSheets(bytes);
  let selected: { sheet: WorkbookSheet; headerRow: number; headers: string[] } | null = null;
  for (const sheet of sheets) {
    for (let rowIndex = 0; rowIndex < Math.min(sheet.rows.length, 15); rowIndex += 1) {
      const headers = sheet.rows[rowIndex].map(normalizeHeader);
      const hasModel = headers.includes("MODEL");
      const hasDescription = headers.includes("DESCRIPTION");
      const hasItemNo = headers.some((header) => header.includes("ITEM NO"));
      const hasVndPrice = headers.some((header) => header.includes("PRICE LIST VND") || header.includes("PRICE LIST DONG"));
      if (hasModel && hasDescription && hasItemNo && hasVndPrice) selected = { sheet, headerRow: rowIndex, headers };
    }
  }
  if (!selected) throw new Error("Không tìm thấy sheet bảng giá có Model, Description và giá VND.");

  const headers = headerMap(selected.headers);
  const family = findIndex(headers, (header) => header === "PRODUCT FAMILY");
  const group = findIndex(headers, (header) => header === "MODEL GROUP");
  const market = findIndex(headers, (header) => header === "MARKET MODEL");
  const model = findIndex(headers, (header) => header === "MODEL");
  const itemNo = findIndex(headers, (header) => header.includes("ITEM NO"));
  const description = findIndex(headers, (header) => header === "DESCRIPTION");
  const origin = findIndex(headers, (header) => header.includes("COUNTRY OF ORIGIN"));
  const usd = findIndex(headers, (header) => header.includes("PRICE LIST USD"));
  const vnd = findIndex(headers, (header) => header.includes("PRICE LIST VND") || header.includes("PRICE LIST DONG"));
  const status = findIndex(headers, (header) => header === "ITEM STATUS");
  const weight = findIndex(headers, (header) => header.includes("GROSS WEIGHT"));
  const uom = findIndex(headers, (header) => header.includes("UOM"));
  const warranty = findIndex(headers, (header) => header.includes("WARRANTY"));

  const rows = selected.sheet.rows.slice(selected.headerRow + 1).flatMap<ImportedProduct>((row) => {
    const modelValue = get(row, model);
    const itemNoValue = get(row, itemNo);
    if (!modelValue || !itemNoValue) return [];
    return [{
      productFamily: get(row, family),
      modelGroup: get(row, group),
      marketModel: get(row, market),
      model: modelValue,
      itemNo: itemNoValue,
      description: get(row, description),
      countryOfOrigin: get(row, origin),
      listPriceUsd: number(get(row, usd)),
      listPriceVnd: Math.round(number(get(row, vnd))),
      itemStatus: get(row, status) || "ACTIVE",
      grossWeight: get(row, weight),
      uom: get(row, uom) || "EA",
      warrantyText: get(row, warranty),
    }];
  });
  return { sheetName: selected.sheet.name, rows };
}

export function parseHighTouchXlsx(bytes: Uint8Array) {
  const sheets = workbookSheets(bytes);
  const byKey = new Map<string, ImportedHighTouch>();
  for (const sheet of sheets) {
    const headerRow = sheet.rows.findIndex((row, index) => index < 12 && row.map(normalizeHeader).includes("MODEL") && row.map(normalizeHeader).includes("DESCRIPTION"));
    if (headerRow < 0) continue;
    const headers = headerMap(sheet.rows[headerRow]);
    const family = findIndex(headers, (header) => header === "PRODUCT FAMILY");
    const group = findIndex(headers, (header) => header === "MODEL GROUP");
    const market = findIndex(headers, (header) => header === "MARKET MODEL");
    const model = findIndex(headers, (header) => header === "MODEL");
    const itemNo = findIndex(headers, (header) => header.includes("ITEM NO"));
    const description = findIndex(headers, (header) => header === "DESCRIPTION");
    const origin = findIndex(headers, (header) => header.includes("COUNTRY OF ORIGIN") || header === "COO");
    for (const row of sheet.rows.slice(headerRow + 1)) {
      const modelValue = get(row, model);
      if (!modelValue) continue;
      const itemNoValue = get(row, itemNo);
      const key = itemNoValue || modelValue.toUpperCase().replace(/\s+/g, " ").trim();
      if (!byKey.has(key)) byKey.set(key, {
        productFamily: get(row, family), modelGroup: get(row, group), marketModel: get(row, market),
        model: modelValue, itemNo: itemNoValue, description: get(row, description), countryOfOrigin: get(row, origin),
      });
    }
  }
  if (!byKey.size) throw new Error("Không tìm thấy danh sách Model High‑Touch trong file.");
  return { sheetCount: sheets.length, rows: [...byKey.values()] };
}

export function parseTargetLeadsXlsx(bytes: Uint8Array) {
  const sheets = workbookSheets(bytes);
  const sheet = sheets.find((item) => normalizeHeader(item.name) === "MASTER ACCOUNTS") ?? sheets[0];
  if (!sheet) throw new Error("File Excel không có sheet dữ liệu Lead.");
  const headerRow = sheet.rows.findIndex((row, index) => {
    if (index >= 20) return false;
    const headers = row.map(normalizeHeader);
    return headers.includes("COMPANY") && headers.includes("PLANT/SITE") && headers.includes("PUBLIC EMAIL");
  });
  if (headerRow < 0) throw new Error("Không tìm thấy dòng tiêu đề Company, Plant/Site và Public Email.");

  const headers = headerMap(sheet.rows[headerRow]);
  const required = (header: string) => {
    const index = findIndex(headers, (value) => value === header);
    if (index < 0) throw new Error(`File thiếu cột bắt buộc: ${header}.`);
    return index;
  };
  const company = required("COMPANY");
  const site = required("PLANT/SITE");
  const province = required("PROVINCE");
  const location = required("INDUSTRIAL PARK/LOCATION");
  const industry = required("INDUSTRY");
  const subIndustry = required("SUB-INDUSTRY");
  const priority = required("PRIORITY A/B/C");
  const painPoint = required("PAIN POINT");
  const solution = required("RECOMMENDED FLUKE SOLUTION");
  const personas = required("TARGET PERSONAS");
  const website = required("WEBSITE/SOURCE");
  const sourceNotes = required("NOTES");
  const publicEmail = required("PUBLIC EMAIL");
  const contactType = required("CONTACT TYPE");
  const contactSource = required("EMAIL / CONTACT SOURCE");
  const confidence = required("CONFIDENCE");

  const dataRows = sheet.rows.slice(headerRow + 1).filter((row) => get(row, company));
  if (!dataRows.length) throw new Error("File không có công ty hợp lệ để nhập.");
  if (dataRows.length > 1000) throw new Error("Mỗi lần chỉ nhập tối đa 1.000 Lead.");
  const rows = dataRows.map<ImportedTargetLead>((row, rowIndex) => {
    const email = get(row, publicEmail).toLowerCase();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      throw new Error(`Email chưa hợp lệ tại dòng Excel ${headerRow + rowIndex + 2}: ${email}.`);
    }
    const siteName = get(row, site);
    const noteLines = [
      siteName && `Nhà máy/Site: ${siteName}`,
      get(row, province) && `Tỉnh/Thành phố: ${get(row, province)}`,
      get(row, location) && `KCN/Địa điểm: ${get(row, location)}`,
      get(row, priority) && `Ưu tiên: ${get(row, priority)}`,
      get(row, painPoint) && `Pain point: ${get(row, painPoint)}`,
      get(row, solution) && `Giải pháp Fluke đề xuất: ${get(row, solution)}`,
      get(row, personas) && `Bộ phận cần tiếp cận: ${get(row, personas)}`,
      get(row, sourceNotes) && `Ghi chú nguồn: ${get(row, sourceNotes)}`,
      get(row, contactType) && `Loại email/liên hệ: ${get(row, contactType)}`,
      get(row, confidence) && `Mức xác minh: ${get(row, confidence)}`,
      get(row, contactSource) && `Nguồn email/liên hệ: ${get(row, contactSource)}`,
    ].filter(Boolean);
    return {
      id: `LED-MB26-${String(rowIndex + 1).padStart(4, "0")}`,
      companyName: get(row, company),
      website: get(row, website),
      industry: [get(row, industry), get(row, subIndustry)].filter(Boolean).join(" · "),
      accountType: "End-User",
      contactName: siteName,
      title: get(row, personas),
      email,
      phone: "",
      source: "Master Target Accounts Miền Bắc 2026",
      notes: noteLines.join("\n"),
      owner: "Mai Trần Thành",
    };
  });
  return { sheetName: sheet.name, rows };
}

const dateFromText = (value: string) => {
  const serial = Number(text(value));
  if (Number.isFinite(serial) && serial >= 1 && serial <= 100000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  const match = value.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
};

const valueAfterLabel = (sheet: WorkbookSheet, label: string) => {
  const expected = normalizeHeader(label);
  for (const row of sheet.rows) {
    const index = row.findIndex((cell) => normalizeHeader(cell) === expected);
    if (index >= 0) return get(row, index + 1);
  }
  return "";
};

const valueWithPrefix = (sheet: WorkbookSheet, prefix: string) => {
  const expected = normalizeHeader(prefix);
  for (const row of sheet.rows) {
    for (const cell of row) {
      const value = text(cell);
      if (normalizeHeader(value).startsWith(expected)) return value.replace(/^.*?:/, "").trim();
    }
  }
  return "";
};

export function parseQuotationWorkbookXlsx(bytes: Uint8Array) {
  const sheets = workbookSheets(bytes);
  const quotations = sheets.flatMap<ImportedQuotation>((sheet) => {
    const itemHeaderRow = sheet.rows.findIndex((row) => {
      const headers = row.map(normalizeHeader);
      return headers.includes("DESCRIPTION") && headers.includes("QTY") && headers.includes("UNIT PRICE");
    });
    if (itemHeaderRow < 0) return [];

    const itemHeaders = headerMap(sheet.rows[itemHeaderRow]);
    const itemNumberIndex = findIndex(itemHeaders, (header) => header.includes("ITEM NUMBER") || header === "MODEL");
    const descriptionIndex = findIndex(itemHeaders, (header) => header === "DESCRIPTION");
    const unitIndex = findIndex(itemHeaders, (header) => header === "UNIT");
    const quantityIndex = findIndex(itemHeaders, (header) => header === "QTY" || header === "QUANTITY");
    const unitPriceIndex = findIndex(itemHeaders, (header) => header === "UNIT PRICE");
    const items: ImportedQuotationItem[] = [];
    for (const row of sheet.rows.slice(itemHeaderRow + 1)) {
      const firstCell = normalizeHeader(row[0]);
      if (firstCell.startsWith("VAT") || firstCell === "TOTAL") break;
      const description = get(row, descriptionIndex);
      const rawItemNumber = get(row, itemNumberIndex);
      if (!description && !rawItemNumber) continue;
      const descriptionModel = description.split(/\s+-\s+/)[0]?.trim() ?? "";
      const itemNumber = !rawItemNumber || /^\d+(?:\.\d+)?$/.test(rawItemNumber) || rawItemNumber.length < 3
        ? descriptionModel
        : rawItemNumber;
      const unitPrice = Math.round(number(get(row, unitPriceIndex)));
      items.push({
        itemNumber,
        description,
        application: description,
        unit: get(row, unitIndex) || "PCS",
        quantity: Math.max(1, number(get(row, quantityIndex)) || 1),
        listPrice: unitPrice,
        discountPercent: 0,
        origin: "",
        warranty: "12 tháng",
        unitPrice,
      });
    }

    const quotationNo = valueAfterLabel(sheet, "QUOTATION NO.") || valueAfterLabel(sheet, "QUOTATION NO") || sheet.name;
    const recipientCompany = valueAfterLabel(sheet, "TO");
    if (!quotationNo || !recipientCompany || items.length === 0) return [];

    const termsHeaderRow = sheet.rows.findIndex((row) => row.map(normalizeHeader).includes("SHIPPING METHOD"));
    const termHeaders = termsHeaderRow >= 0 ? headerMap(sheet.rows[termsHeaderRow]) : new Map<string, number>();
    const termValues = termsHeaderRow >= 0 ? sheet.rows[termsHeaderRow + 1] ?? [] : [];
    const term = (name: string) => get(termValues, findIndex(termHeaders, (header) => header === name));
    const vatRow = sheet.rows.find((row) => normalizeHeader(row[0]).startsWith("VAT"));
    const vatMatch = text(vatRow?.[0]).match(/(\d+(?:[.,]\d+)?)\s*%/);
    const preparedRow = sheet.rows.find((row) => normalizeHeader(row[0]).startsWith("QUOTATION PREPARED BY"));
    const preparedBy = preparedRow?.map(text).find((value, index) => index > 0 && Boolean(value)) ?? "";

    return [{
      sheetName: sheet.name,
      quotationNo,
      quoteDate: dateFromText(valueAfterLabel(sheet, "DATE")) || new Date().toISOString().slice(0, 10),
      expirationDate: dateFromText(valueAfterLabel(sheet, "EXPIRATION DATE")),
      customerId: valueAfterLabel(sheet, "CUSTOMER ID"),
      recipientCompany,
      recipientAddress: valueWithPrefix(sheet, "ADD"),
      attention: valueWithPrefix(sheet, "ATTN"),
      recipientEmail: term("EMAIL"),
      shippingMethod: term("SHIPPING METHOD") || "Air Shipment",
      shippingTerms: term("SHIPPING TERMS") || "DDP",
      deliveryDate: term("DELIVERY DATE") || "2-4 Weeks",
      paymentTerms: term("PAYMENT TERMS") || "100% TT",
      currency: ["VNĐ", "VND"].includes(term("CURRENCY").toUpperCase()) ? "VND" : term("CURRENCY") || "VND",
      vatRate: vatMatch ? number(vatMatch[1].replace(",", ".")) : 8,
      preparedBy: preparedBy || "MAI TRẦN THÀNH (+84 964 72 72 33)",
      status: "Sent",
      notes: `Nhập từ sheet ${sheet.name}`,
      items,
    }];
  });
  if (!quotations.length) {
    throw new Error("Không tìm thấy sheet báo giá hợp lệ. Mỗi sheet cần có số báo giá, công ty nhận và bảng sản phẩm.");
  }
  return { sheetCount: sheets.length, quotations };
}

export function parseInventoryXlsx(bytes: Uint8Array) {
  const sheets = workbookSheets(bytes);
  for (const sheet of sheets) {
    const headerRow = sheet.rows.findIndex((row, index) => {
      if (index > 25) return false;
      const headers = row.map(normalizeHeader);
      return headers.includes("MÃ VẬT TƯ") && headers.includes("MÃ NCC") && headers.includes("SỐ LƯỢNG");
    });
    if (headerRow < 0) continue;
    const headers = headerMap(sheet.rows[headerRow]);
    const materialCode = findIndex(headers, (header) => header === "MÃ VẬT TƯ");
    const itemNo = findIndex(headers, (header) => header === "MÃ NCC");
    const description = findIndex(headers, (header) => header === "TÊN VẬT TƯ");
    const unit = findIndex(headers, (header) => header === "ĐVT" || header === "ĐVT.");
    const quantity = findIndex(headers, (header) => header === "SỐ LƯỢNG");
    const reportDate = sheet.rows.slice(0, headerRow).flat().map(text).map(dateFromText).find(Boolean) ?? "";
    const rows = sheet.rows.slice(headerRow + 1).flatMap<ImportedInventoryItem>((row) => {
      const materialCodeValue = get(row, materialCode);
      const itemNoValue = get(row, itemNo);
      const descriptionValue = get(row, description);
      if (!materialCodeValue || (!itemNoValue && !descriptionValue)) return [];
      return [{
        materialCode: materialCodeValue,
        itemNo: itemNoValue,
        description: descriptionValue,
        unit: get(row, unit) || "Bộ",
        quantity: number(get(row, quantity)),
      }];
    });
    if (!rows.length) throw new Error("File tồn kho không có dòng sản phẩm hợp lệ.");
    return { sheetName: sheet.name, reportDate, rows };
  }
  throw new Error("Không tìm thấy sheet tồn kho có Mã vật tư, Mã NCC và Số lượng.");
}

export function parseWeeklyReportXlsx(bytes: Uint8Array): WeeklyReport {
  const sheets = workbookSheets(bytes);
  const sheet = sheets.find((candidate) => candidate.rows.some((row) => row.some((cell) => normalizeHeader(cell).includes("PROJECT STATUS REPORT"))));
  if (!sheet) throw new Error("Không tìm thấy mẫu Project Status Report trong file.");
  const plannerHeader = sheet.rows.findIndex((row) => row.map(normalizeHeader).includes("MAIN ACTIVITY"));
  const projectHeader = sheet.rows.findIndex((row) => row.map(normalizeHeader).includes("PROJECT NAME / DESCRIPTION"));
  if (plannerHeader < 0 || projectHeader < 0) throw new Error("File báo cáo thiếu phần Weekly planner hoặc Project Status Report.");

  const updateRow = sheet.rows.find((row) => normalizeHeader(row[0]) === "UPDATE") ?? [];
  const reporterRow = sheet.rows.find((row) => normalizeHeader(row[0]) === "REPORTER") ?? [];
  const parsedDate = updateRow.map(text).map(dateFromText).find(Boolean) ?? new Date().toISOString().slice(0, 10);
  const report = emptyWeeklyReport(parsedDate);
  report.reportDate = parsedDate;
  report.reporter = reporterRow.map(text).find((value, index) => index > 0 && Boolean(value)) || report.reporter;
  report.weekNumber = Math.round(number(sheet.rows[plannerHeader]?.[0])) || report.weekNumber;
  report.sourceFile = sheet.name;
  report.plan = report.plan.map((plan, index) => {
    const row = sheet.rows[plannerHeader + 1 + index] ?? [];
    return { ...plan, mainActivity: text(row[1]), location: text(row[2]) || "Văn phòng", remarks: text(row[7]) };
  });

  const projects: WeeklyProjectItem[] = [];
  for (const [index, row] of sheet.rows.slice(projectHeader + 1).entries()) {
    if (!row.some((cell) => text(cell))) continue;
    projects.push({
      id: `WPI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      status: normalizeHeader(row[0]) === "C" ? "C" : "A",
      projectName: text(row[1]), customer: text(row[2]), projectLead: text(row[3]),
      startDate: dateFromText(text(row[4])) || text(row[4]),
      preliminaryEndDate: dateFromText(text(row[5])) || text(row[5]),
      adjustedEndDate: dateFromText(text(row[6])) || text(row[6]),
      comments: text(row[7]),
    });
    if (index > 99) break;
  }
  report.projects = projects;
  return report;
}
