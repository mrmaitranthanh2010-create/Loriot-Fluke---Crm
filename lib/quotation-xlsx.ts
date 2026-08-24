import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Quotation } from "@/lib/crm";

const escapeXml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const formatDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};

const englishMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatExpirationDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const monthName = englishMonthNames[Number(match[2]) - 1];
  return monthName ? `${match[3]}-${monthName}-${match[1]}` : value;
};

const cellPattern = (reference: string) => new RegExp(
  `<x:c\\b(?=[^>]*\\br="${reference}")[^>]*/\\s*>|<x:c\\b(?=[^>]*\\br="${reference}")[^>]*>[\\s\\S]*?<\\/x:c>`,
);

const cellStyle = (cellXml: string) => cellXml.match(/\bs="([^"]+)"/)?.[1];

const stringCell = (reference: string, style: string | undefined, value: unknown) =>
  `<x:c r="${reference}"${style ? ` s="${style}"` : ""} t="inlineStr"><x:is><x:t xml:space="preserve">${escapeXml(value)}</x:t></x:is></x:c>`;

const numberCell = (reference: string, style: string | undefined, value: number) =>
  `<x:c r="${reference}"${style ? ` s="${style}"` : ""} t="n"><x:v>${Number.isFinite(value) ? value : 0}</x:v></x:c>`;

const formulaCell = (reference: string, style: string | undefined, formula: string, value: number) =>
  `<x:c r="${reference}"${style ? ` s="${style}"` : ""} t="n"><x:f>${escapeXml(formula)}</x:f><x:v>${Number.isFinite(value) ? value : 0}</x:v></x:c>`;

const replaceCell = (
  xml: string,
  reference: string,
  factory: (style: string | undefined) => string,
) => {
  const pattern = cellPattern(reference);
  const existing = xml.match(pattern)?.[0];
  if (!existing) throw new Error(`Ô ${reference} không tồn tại trong mẫu báo giá.`);
  return xml.replace(pattern, factory(cellStyle(existing)));
};

const shiftRowXml = (rowXml: string, oldRow: number, newRow: number) => rowXml
  .replace(new RegExp(`(<x:row\\b[^>]*\\br=")${oldRow}("[^>]*>)`), `$1${newRow}$2`)
  .replace(new RegExp(`r="([A-Z]+)${oldRow}"`, "g"), `r="$1${newRow}"`);

const shiftRange = (reference: string, threshold: number, delta: number) =>
  reference.replace(/([A-Z]+)(\d+)/g, (full, column, rowText) => {
    const row = Number(rowText);
    return row >= threshold ? `${column}${row + delta}` : full;
  });

const quotationSheetName = (quotationNo: string) => {
  const cleaned = quotationNo.replace(/[\\/*?:[\]]/g, "-").slice(0, 31);
  return cleaned || "Quotation";
};

const originNames: Record<string, string> = {
  US: "USA", CN: "CHINA", SG: "SINGAPORE", MY: "MALAYSIA", VN: "VIETNAM", TH: "THAILAND",
  TW: "TAIWAN", DE: "GERMANY", GB: "UNITED KINGDOM", CZ: "CZECH REPUBLIC", RO: "ROMANIA",
  MX: "MEXICO", LT: "LITHUANIA", ID: "INDONESIA", KH: "CAMBODIA", JP: "JAPAN",
};

const quotationOrigin = (value: string) => originNames[value.trim().toUpperCase()] ?? (value.trim() || "N/A");

const quotationDescription = (item: Quotation["items"][number]) => {
  const base = item.description.trim();
  const lines = [base];
  const application = item.application?.trim();
  if (application && application.toLocaleLowerCase("vi").replace(/\s+/g, " ") !== base.toLocaleLowerCase("vi").replace(/\s+/g, " ")) {
    lines.push(`Application: ${application}`);
  }
  if (!/\bmaker\s*:/i.test(base) && !/\borigin\s*:/i.test(base)) {
    lines.push(`Maker: FLUKE. Origin: ${quotationOrigin(item.origin)}`);
  }
  if (!/\bwarranty\s*:/i.test(base)) lines.push(`Warranty: ${item.warranty || "12 tháng"}`);
  return lines.filter(Boolean).join("\n");
};

const quotationRowHeight = (description: string) => {
  const visualLines = description.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 48)), 0);
  return Math.max(52, Math.min(150, 14 + visualLines * 15));
};

export function generateQuotationXlsx(template: Uint8Array, quotation: Quotation) {
  const files = unzipSync(template);
  const read = (name: string) => strFromU8(files[name]);
  const write = (name: string, value: string) => { files[name] = strToU8(value); };
  const worksheetPath = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const drawingPath = Object.keys(files).find((name) => /^xl\/drawings\/drawing\d+\.xml$/.test(name));
  if (!worksheetPath) throw new Error("Mẫu báo giá thiếu worksheet.");
  const items = quotation.items.length > 0 ? quotation.items : [{
    id: "", quotationId: quotation.id, lineNo: 1, itemNumber: "", description: "", application: "", unit: "PCS", quantity: 1,
    productId: "", listPrice: 0, discountPercent: 0, origin: "", warranty: "12 tháng", unitPrice: 0, amount: 0,
  }];
  const delta = items.length - 1;

  let sheetXml = read(worksheetPath);
  const sheetDataMatch = sheetXml.match(/<x:sheetData>([\s\S]*?)<\/x:sheetData>/);
  if (!sheetDataMatch) throw new Error("Mẫu báo giá thiếu vùng dữ liệu.");
  const rows = [...sheetDataMatch[1].matchAll(/<x:row\b[^>]*(?:\/>|>[\s\S]*?<\/x:row>)/g)].map((match) => match[0]);
  const baseItemRow = rows.find((row) => /<x:row\b[^>]*\br="18"/.test(row));
  if (!baseItemRow) throw new Error("Mẫu báo giá thiếu dòng sản phẩm.");

  const generatedRows: string[] = [];
  for (const rowXml of rows) {
    const rowNumber = Number(rowXml.match(/<x:row\b[^>]*\br="(\d+)"/)?.[1]);
    if (rowNumber < 18) generatedRows.push(rowXml);
    else if (rowNumber === 18) {
      for (const [index, item] of items.entries()) {
        const row = 18 + index;
        let itemRow = shiftRowXml(baseItemRow, 18, row);
        const description = quotationDescription(item);
        itemRow = itemRow.replace(/\bht="[^"]+"/, `ht="${quotationRowHeight(description)}"`);
        itemRow = replaceCell(itemRow, `A${row}`, (style) => numberCell(`A${row}`, style, index + 1));
        itemRow = replaceCell(itemRow, `B${row}`, (style) => stringCell(`B${row}`, style, item.itemNumber));
        itemRow = replaceCell(itemRow, `C${row}`, (style) => stringCell(`C${row}`, style, description));
        itemRow = replaceCell(itemRow, `D${row}`, (style) => stringCell(`D${row}`, style, ""));
        itemRow = replaceCell(itemRow, `E${row}`, (style) => stringCell(`E${row}`, style, item.unit));
        itemRow = replaceCell(itemRow, `F${row}`, (style) => numberCell(`F${row}`, style, item.quantity));
        itemRow = replaceCell(itemRow, `G${row}`, (style) => numberCell(`G${row}`, style, item.unitPrice));
        itemRow = replaceCell(itemRow, `H${row}`, (style) => formulaCell(`H${row}`, style, `G${row}*F${row}`, item.amount));
        generatedRows.push(itemRow);
      }
    } else generatedRows.push(shiftRowXml(rowXml, rowNumber, rowNumber + delta));
  }
  sheetXml = sheetXml.replace(sheetDataMatch[0], `<x:sheetData>${generatedRows.join("")}</x:sheetData>`);

  const lastItemRow = 17 + items.length;
  const vatRow = lastItemRow + 1;
  const totalRow = vatRow + 1;
  const preparedRow = 32 + delta;
  const headerStrings: Array<[string, string]> = [
    ["G4", quotation.quotationNo],
    ["G5", formatDate(quotation.quoteDate)],
    ["G6", quotation.customerId],
    ["G7", formatExpirationDate(quotation.expirationDate)],
    ["B8", quotation.recipientCompany],
    ["B9", `ADD  : ${quotation.recipientAddress}`],
    ["B10", `ATTN : ${quotation.attention}`],
    ["A15", quotation.recipientEmail],
    ["C15", quotation.shippingMethod],
    ["D15", quotation.shippingTerms],
    ["E15", quotation.deliveryDate],
    ["G15", quotation.paymentTerms],
    ["H15", quotation.currency],
    [`A${vatRow}`, `VAT ${quotation.vatRate}%`],
    [`C${preparedRow}`, quotation.preparedBy],
  ];
  for (const [reference, value] of headerStrings) {
    sheetXml = replaceCell(sheetXml, reference, (style) => stringCell(reference, style, value));
  }
  sheetXml = replaceCell(sheetXml, `H${vatRow}`, (style) => formulaCell(
    `H${vatRow}`, style, `SUM(H18:H${lastItemRow})*${quotation.vatRate}%`, quotation.vatAmount,
  ));
  sheetXml = replaceCell(sheetXml, `H${totalRow}`, (style) => formulaCell(
    `H${totalRow}`, style, `SUM(H18:H${vatRow})`, quotation.total,
  ));

  sheetXml = sheetXml.replace(/<x:mergeCells>([\s\S]*?)<\/x:mergeCells>/, (_all, content) => {
    const entries = [...content.matchAll(/<x:mergeCell\s+ref="([^"]+)"\s*\/>/g)].flatMap((match) => {
      if (match[1] === "C18:D18") return items.map((_item, index) => `<x:mergeCell ref="C${18 + index}:D${18 + index}" />`);
      return [`<x:mergeCell ref="${shiftRange(match[1], 19, delta)}" />`];
    });
    return `<x:mergeCells>${entries.join("")}</x:mergeCells>`;
  });
  sheetXml = sheetXml.replace(
    /(<x:worksheet\b[^>]*>)/,
    '$1<x:sheetPr><x:pageSetUpPr fitToPage="1" autoPageBreaks="0" /></x:sheetPr>',
  );
  sheetXml = sheetXml.replace(
    /<x:pageMargins\b[^>]*\/>/,
    '<x:pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2" />' +
    '<x:pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1" horizontalDpi="300" verticalDpi="300" />',
  );
  write(worksheetPath, sheetXml);

  if (drawingPath) {
    let drawingXml = read(drawingPath);
    drawingXml = drawingXml.replace(/<xdr:row>(\d+)<\/xdr:row>/g, (_all, value) => {
      const row = Number(value);
      return `<xdr:row>${row >= 18 ? row + delta : row}</xdr:row>`;
    });
    write(drawingPath, drawingXml);
  }

  const sheetName = quotationSheetName(quotation.quotationNo);
  let workbookXml = read("xl/workbook.xml").replace(/(<x:sheet\s+name=")[^"]+("[^>]*>)/, `$1${escapeXml(sheetName)}$2`);
  workbookXml = workbookXml.replace(/<x:definedNames>[\s\S]*?<\/x:definedNames>/, "");
  workbookXml = workbookXml.replace("</x:workbook>", `<x:definedNames><x:definedName name="_xlnm.Print_Area" localSheetId="0">'${escapeXml(sheetName.replaceAll("'", "''"))}'!$A$2:$H$${36 + delta}</x:definedName></x:definedNames></x:workbook>`);
  write("xl/workbook.xml", workbookXml);

  return zipSync(files, { level: 6 });
}
