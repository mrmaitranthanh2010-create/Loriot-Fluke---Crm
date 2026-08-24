import fs from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) throw new Error("Usage: clean-quotation-template.mjs <input.xlsx> <output.xlsx>");

const files = unzipSync(new Uint8Array(await fs.readFile(inputPath)));
const read = (name) => strFromU8(files[name]);
const write = (name, value) => { files[name] = strToU8(value); };
const unescapeXml = (value) => value
  .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "\"")
  .replaceAll("&apos;", "'").replaceAll("&amp;", "&");
const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;").replaceAll("'", "&apos;");

const sharedXml = read("xl/sharedStrings.xml");
const sharedStrings = [...sharedXml.matchAll(/<x:si>([\s\S]*?)<\/x:si>/g)].map((match) =>
  [...match[1].matchAll(/<x:t(?:\s[^>]*)?>([\s\S]*?)<\/x:t>/g)].map((part) => unescapeXml(part[1])).join(""),
);

let sheetXml = read("xl/worksheets/sheet2.xml");
sheetXml = sheetXml.replace(/<x:c([^>]*?)\bt="s"([^>]*)>\s*<x:v>(\d+)<\/x:v>\s*<\/x:c>/g, (_all, before, after, index) => {
  const value = sharedStrings[Number(index)] ?? "";
  return `<x:c${before}t="inlineStr"${after}><x:is><x:t xml:space="preserve">${escapeXml(value)}</x:t></x:is></x:c>`;
});
sheetXml = sheetXml.replace(/<x:hyperlinks>[\s\S]*?<\/x:hyperlinks>/g, "");
write("xl/worksheets/sheet2.xml", sheetXml);

let workbookXml = read("xl/workbook.xml");
const selectedSheet = workbookXml.match(/<x:sheet\s+name="SMFT - 1000 Pro"[^>]*\/>/)?.[0];
if (!selectedSheet) throw new Error("Không tìm thấy sheet mẫu SMFT - 1000 Pro.");
const quotationSheet = selectedSheet.replace('name="SMFT - 1000 Pro"', 'name="Quotation"').replace(/sheetId="\d+"/, 'sheetId="1"');
workbookXml = workbookXml.replace(/<x:sheets>[\s\S]*?<\/x:sheets>/, `<x:sheets>${quotationSheet}</x:sheets>`);
write("xl/workbook.xml", workbookXml);

let workbookRels = read("xl/_rels/workbook.xml.rels");
workbookRels = workbookRels.replace(/<Relationship\b[^>]*\/>/g, (relationship) => {
  if (relationship.includes("/worksheet") && !relationship.includes("/xl/worksheets/sheet2.xml")) return "";
  if (relationship.includes("/sharedStrings")) return "";
  return relationship;
});
write("xl/_rels/workbook.xml.rels", workbookRels);

let sheetRels = read("xl/worksheets/_rels/sheet2.xml.rels");
sheetRels = sheetRels.replace(/<Relationship\b[^>]*\/?>/g, (relationship) => relationship.includes("/hyperlink") ? "" : relationship);
sheetRels = sheetRels.replace('Target="/xl/drawings/drawing2.xml"', 'Target="../drawings/drawing2.xml"');
write("xl/worksheets/_rels/sheet2.xml.rels", sheetRels);

let drawingRels = read("xl/drawings/_rels/drawing2.xml.rels");
drawingRels = drawingRels.replaceAll('Target="/xl/media/image3.png"', 'Target="../media/image3.png"');
drawingRels = drawingRels.replaceAll('Target="/xl/media/image4.png"', 'Target="../media/image4.png"');
write("xl/drawings/_rels/drawing2.xml.rels", drawingRels);

let contentTypes = read("[Content_Types].xml");
contentTypes = contentTypes.replace(/<Override\b[^>]*\/>/g, (entry) => {
  const sheet = entry.match(/PartName="\/xl\/worksheets\/sheet(\d+)\.xml"/);
  if (sheet && sheet[1] !== "2") return "";
  const drawing = entry.match(/PartName="\/xl\/drawings\/drawing(\d+)\.xml"/);
  if (drawing && drawing[1] !== "2") return "";
  if (entry.includes('PartName="/xl/sharedStrings.xml"') || entry.includes('PartName="/docProps/custom.xml"')) return "";
  return entry;
});
write("[Content_Types].xml", contentTypes);

let rootRels = read("_rels/.rels");
rootRels = rootRels.replace(/<Relationship\b[^>]*\/?>/g, (relationship) => relationship.includes("custom-properties") ? "" : relationship);
write("_rels/.rels", rootRels);

write("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Loriot CRM</dc:creator><cp:lastModifiedBy>Loriot CRM</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-08-22T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-22T00:00:00Z</dcterms:modified></cp:coreProperties>`);
write("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Loriot CRM</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>Công ty TNHH Công Nghiệp Vàng Anh / Loriot Industrial</Company><AppVersion>1.0</AppVersion></Properties>`);

for (const name of Object.keys(files)) {
  const remove =
    (name.startsWith("xl/worksheets/sheet") && name !== "xl/worksheets/sheet2.xml") ||
    (name.startsWith("xl/worksheets/_rels/sheet") && name !== "xl/worksheets/_rels/sheet2.xml.rels") ||
    (name.startsWith("xl/drawings/drawing") && name !== "xl/drawings/drawing2.xml") ||
    (name.startsWith("xl/drawings/_rels/drawing") && name !== "xl/drawings/_rels/drawing2.xml.rels") ||
    (name.startsWith("xl/media/") && !["xl/media/image3.png", "xl/media/image4.png"].includes(name)) ||
    name === "xl/sharedStrings.xml" || name === "docProps/custom.xml";
  if (remove) delete files[name];
}

await fs.mkdir(new URL(".", `file://${outputPath}`).pathname, { recursive: true });
await fs.writeFile(outputPath, zipSync(files, { level: 9 }));
console.log(`Prepared clean template: ${outputPath}`);
