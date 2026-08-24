import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { WeeklyReport, WeeklyProjectItem } from "@/lib/operations";

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

const reportDateLabel = (value: string) => `Friday, ${formatDate(value)}`;

const cellPattern = (reference: string) => new RegExp(
  `<c\\b(?=[^>]*\\br="${reference}")[^>]*/\\s*>|<c\\b(?=[^>]*\\br="${reference}")[^>]*>[\\s\\S]*?<\\/c>`,
);

const rowPattern = (row: number) => new RegExp(`<row\\b(?=[^>]*\\br="${row}")[^>]*>[\\s\\S]*?<\\/row>`);
const cellStyle = (cellXml: string) => cellXml.match(/\bs="([^"]+)"/)?.[1];
const stringCell = (reference: string, style: string | undefined, value: unknown) =>
  `<c r="${reference}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;

const numberCell = (reference: string, style: string | undefined, value: number) =>
  `<c r="${reference}"${style ? ` s="${style}"` : ""} t="n"><v>${Number.isFinite(value) ? value : 0}</v></c>`;

const replaceCell = (xml: string, reference: string, value: string | number, fallbackStyle?: string) => {
  const pattern = cellPattern(reference);
  const existing = xml.match(pattern)?.[0];
  const replacement = typeof value === "number"
    ? numberCell(reference, existing ? cellStyle(existing) : fallbackStyle, value)
    : stringCell(reference, existing ? cellStyle(existing) : fallbackStyle, value);
  if (existing) return xml.replace(pattern, replacement);
  const row = Number(reference.match(/\d+$/)?.[0]);
  const match = xml.match(rowPattern(row))?.[0];
  if (!match) throw new Error(`Mẫu báo cáo thiếu dòng ${row}.`);
  return xml.replace(match, match.replace("</row>", `${replacement}</row>`));
};

const shiftRow = (rowXml: string, oldRow: number, newRow: number) => rowXml
  .replace(new RegExp(`(<row\\b[^>]*\\br=")${oldRow}("[^>]*>)`), `$1${newRow}$2`)
  .replace(new RegExp(`r="([A-Z]+)${oldRow}"`, "g"), `r="$1${newRow}"`);

const projectHeight = (project?: WeeklyProjectItem) => {
  if (!project) return 32;
  const longest = Math.max(project.projectName.length, project.comments.length, project.customer.length);
  return Math.max(46, Math.min(260, 30 + Math.ceil(longest / 78) * 16));
};

const projectValues = (project: WeeklyProjectItem | undefined, index: number): Array<[string, string | number, string]> => [
  ["A", project?.status ?? "", "32"],
  ["B", project?.projectName ?? "", "3"],
  ["C", project?.customer ?? "", "17"],
  ["D", project?.projectLead ?? "", "17"],
  ["E", formatDate(project?.startDate ?? ""), "32"],
  ["F", formatDate(project?.preliminaryEndDate ?? ""), "32"],
  ["G", formatDate(project?.adjustedEndDate ?? ""), "32"],
  ["H", project?.comments ?? "", "17"],
].map(([column, value, style]) => [column, value || (column === "A" && project ? index + 1 : ""), style] as [string, string | number, string]);

export function generateWeeklyReportXlsx(template: Uint8Array, report: WeeklyReport) {
  const files = unzipSync(template);
  const read = (name: string) => files[name] ? strFromU8(files[name]) : "";
  const write = (name: string, value: string) => { files[name] = strToU8(value); };
  let sheetXml = read("xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("Mẫu báo cáo tuần thiếu Sheet1.");

  const headerValues: Array<[string, string | number]> = [
    ["C2", reportDateLabel(report.reportDate)], ["C3", report.reporter], ["A5", report.weekNumber],
  ];
  for (const [reference, value] of headerValues) sheetXml = replaceCell(sheetXml, reference, value);

  report.plan.slice(0, 5).forEach((plan, index) => {
    const row = 6 + index;
    sheetXml = replaceCell(sheetXml, `B${row}`, plan.mainActivity, "35");
    sheetXml = replaceCell(sheetXml, `C${row}`, plan.location, "3");
    sheetXml = replaceCell(sheetXml, `H${row}`, plan.remarks, "3");
    const baseHeight = Math.max(plan.mainActivity.length, plan.remarks.length);
    const height = Math.max(34, Math.min(180, 28 + Math.ceil(baseHeight / 95) * 15));
    sheetXml = sheetXml.replace(rowPattern(row), (rowXml) => {
      let next = rowXml.match(/\bht="[^"]+"/) ? rowXml.replace(/\bht="[^"]+"/, `ht="${height}"`) : rowXml.replace(/<row\b/, `<row ht="${height}"`);
      if (!/\bcustomHeight=/.test(next)) next = next.replace(/<row\b/, '<row customHeight="1"');
      return next;
    });
  });

  const sheetData = sheetXml.match(/<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetData) throw new Error("Mẫu báo cáo tuần thiếu vùng dữ liệu.");
  const rows = [...sheetData[1].matchAll(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g)].map((match) => match[0]);
  const baseProjectRow = rows.find((row) => /<row\b[^>]*\br="18"/.test(row));
  if (!baseProjectRow) throw new Error("Mẫu báo cáo tuần thiếu dòng dự án.");
  const projectCount = Math.max(6, report.projects.length);
  const outputRows: string[] = rows.filter((row) => Number(row.match(/\br="(\d+)"/)?.[1]) < 13);
  for (let index = 0; index < projectCount; index += 1) {
    const rowNumber = 13 + index;
    const existing = rows.find((row) => new RegExp(`<row\\b[^>]*\\br="${rowNumber}"`).test(row));
    let rowXml = existing ?? shiftRow(baseProjectRow, 18, rowNumber);
    const height = projectHeight(report.projects[index]);
    rowXml = rowXml.match(/\bht="[^"]+"/)
      ? rowXml.replace(/\bht="[^"]+"/, `ht="${height}"`)
      : rowXml.replace(/<row\b/, `<row ht="${height}"`);
    for (const [column, value, style] of projectValues(report.projects[index], index)) {
      rowXml = replaceCell(rowXml, `${column}${rowNumber}`, value, style);
    }
    outputRows.push(rowXml);
  }
  sheetXml = sheetXml.replace(sheetData[0], `<sheetData>${outputRows.join("")}</sheetData>`);
  const lastRow = 12 + projectCount;
  sheetXml = sheetXml.replace(/<dimension\s+ref="[^"]+"\s*\/>/, `<dimension ref="A1:H${lastRow}"/>`);
  sheetXml = sheetXml.replace(/<autoFilter\s+ref="[^"]+"/, `<autoFilter ref="A12:H${lastRow}"`);
  write("xl/worksheets/sheet1.xml", sheetXml);

  let workbookXml = read("xl/workbook.xml");
  workbookXml = workbookXml.replace(/Sheet1!\$A\$12:\$H\$\d+/, `Sheet1!$A$12:$H$${lastRow}`);
  write("xl/workbook.xml", workbookXml);
  return zipSync(files, { level: 6 });
}
