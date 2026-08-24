"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Activity, Opportunity } from "@/lib/crm";
import { companyWeekNumber, emptyWeeklyReport, weekBounds, type InventoryItem, type InventorySummary, type WeeklyProjectItem, type WeeklyReport, type WeeklyReportSummary } from "@/lib/operations";
import { parseInventoryXlsx, parseWeeklyReportXlsx } from "@/lib/product-xlsx";
import { generateWeeklyReportXlsx } from "@/lib/weekly-report-xlsx";

const shortDate = (value: string) => value ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`)) : "—";
const number = (value: number) => Number(value || 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const downloadBytes = (bytes: Uint8Array, name: string) => {
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

function PageHeader({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="page-header"><div><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><div className="empty-icon">◎</div><strong>{title}</strong><p>{text}</p></div>;
}

function QuantityEditor({ item, onSave, disabled }: { item: InventoryItem; onSave: (id: string, quantity: number) => Promise<void>; disabled: boolean }) {
  const [quantity, setQuantity] = useState(item.quantity);
  return <div className="stock-quantity-editor"><input aria-label={`Tồn kho ${item.materialCode}`} type="number" min="0" step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}/><button className="secondary-button" disabled={disabled || quantity === item.quantity} onClick={(event) => { event.stopPropagation(); void onSave(item.id, quantity); }}>Lưu</button></div>;
}

export function InventoryView({ onError, onNotice }: { onError: (message: string) => void; onNotice: (message: string) => void }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [summary, setSummary] = useState<InventorySummary>({ skuCount: 0, inStockSkuCount: 0, totalQuantity: 0, lowStockCount: 0, unmatchedCount: 0, reportDate: "", sourceFile: "" });
  const [search, setSearch] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: search });
      if (inStockOnly) params.set("inStock", "1");
      const response = await fetch(`/api/inventory?${params}`, { cache: "no-store", signal });
      const result = await response.json() as { items?: InventoryItem[]; summary?: InventorySummary; error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể tải tồn kho.");
      setItems(result.items ?? []);
      if (result.summary) setSummary(result.summary);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      onError(error instanceof Error ? error.message : "Không thể tải tồn kho.");
    }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [inStockOnly, onError, search]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 80);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [load]);

  const importFile = async (file: File) => {
    setSaving(true);
    try {
      const parsed = parseInventoryXlsx(new Uint8Array(await file.arrayBuffer()));
      const response = await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", reportDate: parsed.reportDate, sourceFile: file.name, rows: parsed.rows }) });
      const result = await response.json() as { imported?: number; matched?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể nhập tồn kho.");
      onNotice(`Đã cập nhật ${result.imported ?? parsed.rows.length} mã tồn kho; ghép được ${result.matched ?? 0} mã với danh mục Fluke.`);
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Không thể đọc file tồn kho."); }
    finally { setSaving(false); }
  };

  const saveQuantity = async (id: string, quantity: number) => {
    setSaving(true);
    try {
      const response = await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updateQuantity", id, quantity }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể chỉnh tồn kho.");
      onNotice("Đã cập nhật số lượng tồn kho thủ công.");
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Không thể chỉnh tồn kho."); }
    finally { setSaving(false); }
  };

  return <>
    <PageHeader eyebrow="INVENTORY" title="Tồn kho Fluke" text="Nhập báo cáo tồn kho, tra nhanh số lượng theo Model/Item No. và điều chỉnh khi cần." action={<button className="primary-button page-button" disabled={saving} onClick={() => inputRef.current?.click()}>↑ Cập nhật file tồn kho</button>}/>
    <input ref={inputRef} hidden type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ""; }}/>
    <div className="inventory-metrics">
      <article><span>Mã có tồn</span><strong>{number(Number(summary.inStockSkuCount))}</strong><small>{number(Number(summary.skuCount))} mã trong file</small></article>
      <article><span>Tổng số lượng</span><strong>{number(Number(summary.totalQuantity))}</strong><small>Đơn vị theo file kho</small></article>
      <article><span>Sắp hết hàng</span><strong>{number(Number(summary.lowStockCount))}</strong><small>Còn từ 1 đến 2</small></article>
      <article><span>Chưa ghép danh mục</span><strong>{number(Number(summary.unmatchedCount))}</strong><small>Cần kiểm tra Item No.</small></article>
    </div>
    <section className="panel inventory-source"><div><strong>Kỳ tồn kho: {shortDate(summary.reportDate)}</strong><span>{summary.sourceFile || "Chưa nhập file tồn kho"}</span></div><p>Ghép ưu tiên bằng <b>Mã NCC / Item No.</b>, sau đó mới đối chiếu Model.</p></section>
    <div className="filter-bar"><label className="filter-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Model, Mã NCC hoặc mô tả..."/></label><label className="high-touch-toggle"><input type="checkbox" checked={inStockOnly} onChange={(event) => setInStockOnly(event.target.checked)}/><span>Chỉ hiện mã còn hàng</span></label><span className="result-count">{loading ? "Đang tải..." : `${items.length} kết quả`}</span></div>
    <section className="panel records-panel inventory-panel">{loading && !items.length ? <Empty title="Đang tải tồn kho" text="Dữ liệu sẽ xuất hiện ngay sau khi đọc xong."/> : !items.length ? <Empty title="Chưa có dữ liệu tồn kho" text="Bấm Cập nhật file tồn kho để nhập báo cáo Excel."/> : <div className="table-scroll"><table><thead><tr><th>Mã vật tư</th><th>Mã NCC / Item No.</th><th>Tên vật tư</th><th>ĐVT</th><th>Số lượng</th><th>Ghép sản phẩm / Logcard</th><th>Cập nhật</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.materialCode}</strong></td><td><strong>{item.itemNo || "—"}</strong></td><td><strong>{item.description || item.matchedModel || "—"}</strong><span>{item.matchedModel ? `Model hãng: ${item.matchedModel}` : ""}</span></td><td><strong>{item.unit}</strong></td><td><QuantityEditor key={`${item.id}-${item.quantity}`} item={item} onSave={saveQuantity} disabled={saving}/></td><td>{item.matchedModel ? <><span className="stock-match">ĐÃ GHÉP</span>{item.highTouch && <span className="stock-logcard">CẦN LOGCARD</span>}</> : <span className="stock-unmatched">CHƯA GHÉP</span>}</td><td><strong>{shortDate(item.reportDate)}</strong><span>{new Date(item.updatedAt).toLocaleString("vi-VN")}</span></td></tr>)}</tbody></table></div>}</section>
  </>;
}

const dateInRange = (value: string, start: string, end: string) => value >= start && value <= end;
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function WeeklyReportsView({ opportunities, activities, onError, onNotice }: { opportunities: Opportunity[]; activities: Activity[]; onError: (message: string) => void; onNotice: (message: string) => void }) {
  const initial = useMemo(() => emptyWeeklyReport(), []);
  const [selectedWeek, setSelectedWeek] = useState(initial.weekStart);
  const [report, setReport] = useState<WeeklyReport>(initial);
  const [recent, setRecent] = useState<WeeklyReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (weekStart: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/weekly-reports?weekStart=${encodeURIComponent(weekStart)}`, { cache: "no-store" });
      const result = await response.json() as { report?: WeeklyReport; recent?: WeeklyReportSummary[]; error?: string };
      if (!response.ok || !result.report) throw new Error(result.error || "Không thể tải báo cáo tuần.");
      setReport(result.report); setRecent(result.recent ?? []);
    } catch (error) { onError(error instanceof Error ? error.message : "Không thể tải báo cáo tuần."); }
    finally { setLoading(false); }
  }, [onError]);
  useEffect(() => { const timer = window.setTimeout(() => void load(selectedWeek), 0); return () => window.clearTimeout(timer); }, [load, selectedWeek]);

  const updatePlan = (index: number, key: "mainActivity" | "location" | "remarks", value: string) => setReport({ ...report, plan: report.plan.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) });
  const updateProject = <K extends keyof WeeklyProjectItem>(index: number, key: K, value: WeeklyProjectItem[K]) => setReport({ ...report, projects: report.projects.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) });
  const addProject = () => setReport({ ...report, projects: [...report.projects, { id: `WPI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, status: "A", projectName: "", customer: "", projectLead: "", startDate: "", preliminaryEndDate: "", adjustedEndDate: "", comments: "" }] });

  const save = async (status: WeeklyReport["status"] = report.status) => {
    setSaving(true);
    try {
      const next = { ...report, status };
      const response = await fetch("/api/weekly-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", ...next }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể lưu báo cáo tuần.");
      setReport(next); onNotice(status === "Submitted" ? "Đã đánh dấu báo cáo tuần là Hoàn thành." : "Đã lưu nháp báo cáo tuần.");
      await load(next.weekStart);
    } catch (error) { onError(error instanceof Error ? error.message : "Không thể lưu báo cáo tuần."); }
    finally { setSaving(false); }
  };

  const importReport = async (file: File) => {
    try {
      const parsed = parseWeeklyReportXlsx(new Uint8Array(await file.arrayBuffer()));
      const base = emptyWeeklyReport(selectedWeek);
      setReport({ ...base, reporter: parsed.reporter, plan: parsed.plan, projects: parsed.projects, sourceFile: file.name });
      onNotice(`Đã đọc ${parsed.projects.length} dòng dự án từ mẫu; hãy kiểm tra rồi bấm Lưu nháp.`);
    } catch (error) { onError(error instanceof Error ? error.message : "Không thể đọc file báo cáo tuần."); }
  };

  const fillFromCrm = () => {
    const relevant = opportunities.filter((opportunity) => activities.some((activity) => activity.opportunityId === opportunity.id && dateInRange(activity.activityDate, report.weekStart, report.weekEnd)) || [opportunity.lastContactDate, opportunity.nextStepDue, opportunity.expectedCloseDate].some((date) => dateInRange(date, report.weekStart, report.weekEnd)));
    const source = relevant.length ? relevant : opportunities.filter((item) => item.status === "Open").slice(0, 6);
    const projects = source.map<WeeklyProjectItem>((opportunity) => {
      const logs = activities.filter((activity) => activity.opportunityId === opportunity.id && dateInRange(activity.activityDate, report.weekStart, report.weekEnd));
      const comments = [...logs.map((activity) => `- ${shortDate(activity.activityDate)}: ${activity.summary}${activity.outcome ? ` — ${activity.outcome}` : ""}`), opportunity.nextStep ? `- Next step: ${opportunity.nextStep}${opportunity.nextStepDue ? ` (${shortDate(opportunity.nextStepDue)})` : ""}` : ""].filter(Boolean).join("\n");
      return { id: `WPI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, status: opportunity.status === "Open" ? "A" : "C", projectName: opportunity.productApplication, customer: opportunity.endUserCompany || opportunity.companyName, projectLead: opportunity.contactName, startDate: logs[0]?.activityDate || opportunity.lastContactDate, preliminaryEndDate: opportunity.expectedCloseDate, adjustedEndDate: "", comments };
    });
    setReport({ ...report, projects }); onNotice(`Đã lấy ${projects.length} cơ hội/cập nhật phù hợp từ CRM; bạn có thể chỉnh lại trước khi lưu.`);
  };

  const exportReport = async () => {
    setSaving(true);
    try {
      const response = await fetch("/weekly-report-template.xlsx");
      if (!response.ok) throw new Error("Không thể mở mẫu báo cáo tuần.");
      const bytes = generateWeeklyReportXlsx(new Uint8Array(await response.arrayBuffer()), report);
      downloadBytes(bytes, `Project Status Report - Week ${report.weekNumber} (${shortDate(report.weekStart).replaceAll("/", "-")} - ${shortDate(report.weekEnd).replaceAll("/", "-")}).xlsx`);
      onNotice("Đã xuất file Excel theo đúng mẫu báo cáo tuần.");
    } catch (error) { onError(error instanceof Error ? error.message : "Không thể xuất báo cáo tuần."); }
    finally { setSaving(false); }
  };

  const selectDate = (value: string) => {
    const bounds = weekBounds(value);
    setSelectedWeek(bounds.weekStart);
  };

  return <>
    <PageHeader eyebrow="WEEKLY OPERATING RHYTHM" title="Báo cáo công việc tuần" text="Lập kế hoạch Thứ Hai–Thứ Sáu, cập nhật khách hàng/dự án và xuất Excel theo mẫu sếp gửi." action={<div className="weekly-header-actions"><button className="secondary-button" onClick={() => inputRef.current?.click()}>↑ Nhập file cũ</button><button className="primary-button" disabled={saving || loading} onClick={() => void exportReport()}>↓ Xuất Excel</button></div>}/>
    <input ref={inputRef} hidden type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importReport(file); event.currentTarget.value = ""; }}/>
    <section className="panel weekly-toolbar"><label><span>Chọn tuần</span><input type="date" value={selectedWeek} onChange={(event) => selectDate(event.target.value)}/></label><label><span>Số tuần theo công ty</span><input type="number" min="1" max="54" value={report.weekNumber} onChange={(event) => setReport({ ...report, weekNumber: Number(event.target.value) || companyWeekNumber(report.weekStart) })}/></label><label><span>Người báo cáo</span><input value={report.reporter} onChange={(event) => setReport({ ...report, reporter: event.target.value })}/></label><label><span>Ngày gửi (Thứ Sáu)</span><input type="date" value={report.reportDate} onChange={(event) => setReport({ ...report, reportDate: event.target.value })}/></label><span className={`weekly-state ${report.status.toLowerCase()}`}>{report.status === "Submitted" ? "HOÀN THÀNH" : "BẢN NHÁP"}</span></section>
    {recent.length > 0 && <div className="weekly-recent"><span>Báo cáo gần đây:</span>{recent.slice(0, 6).map((item) => <button key={item.id} className={selectedWeek === item.weekStart ? "active" : ""} onClick={() => setSelectedWeek(item.weekStart)}>W{item.weekNumber} · {shortDate(item.weekStart)}</button>)}</div>}
    <section className="weekly-flow" aria-label="Quy trình vận hành báo cáo tuần"><article><span>1 · THỨ HAI</span><strong>Lập kế hoạch</strong><p>Chọn đúng tuần, ghi việc chính từng ngày và kết quả dự kiến cần đạt.</p></article><i>→</i><article><span>2 · HẰNG NGÀY</span><strong>Cập nhật hành động trong CRM</strong><p>Cập nhật lần liên hệ, Next Step và hạn xử lý; khi hoàn thành, hệ thống lưu thành Activity trong tuần.</p></article><i>→</i><article><span>3 · THỨ SÁU</span><strong>Chốt kết quả & xuất báo cáo</strong><p>Bấm “Lấy cập nhật từ CRM”, kiểm tra kết quả, chọn Hoàn thành rồi xuất Excel.</p></article></section>
    <section className="panel weekly-section"><div className="panel-header"><div><span>WEEKLY PLANNER</span><h2>Kế hoạch từ Thứ Hai đến Thứ Sáu</h2></div><small className="weekly-export-note">Thứ tự này được giữ nguyên khi xuất Excel</small></div><div className="weekly-plan-grid">{report.plan.map((item, index) => <article key={item.dayKey}><header><span className="weekly-day-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{item.label}</strong><span>{shortDate(addDays(report.weekStart, index))}</span></div></header><label><span>Main Activity · Hoạt động chính</span><textarea rows={4} value={item.mainActivity} onChange={(event) => updatePlan(index, "mainActivity", event.target.value)} placeholder="Các hoạt động chính trong ngày..."/></label><div><label><span>Location · Địa điểm</span><input value={item.location} onChange={(event) => updatePlan(index, "location", event.target.value)}/></label><label><span>Remarks · Kết quả dự kiến</span><input value={item.remarks} onChange={(event) => updatePlan(index, "remarks", event.target.value)}/></label></div></article>)}</div></section>
    <section className="panel weekly-section project-report"><div className="panel-header"><div><span>PROJECT STATUS REPORT</span><h2>Công việc và cập nhật khách hàng trong tuần</h2></div><div className="weekly-section-actions"><button className="secondary-button" onClick={fillFromCrm}>Lấy cập nhật từ CRM</button><button className="secondary-button" onClick={addProject}>+ Thêm dòng</button></div></div><div className="weekly-crm-source"><strong>Hành động lấy từ CRM</strong><span>Activity hoàn thành trong tuần; Sản phẩm/ứng dụng; khách hàng hoặc End-User; người liên hệ; ngày liên hệ; ngày dự kiến chốt; Next Step và hạn xử lý.</span></div>{report.projects.length === 0 ? <Empty title="Chưa có dòng báo cáo" text="Thêm thủ công hoặc lấy các cập nhật phù hợp từ CRM."/> : <div className="weekly-project-list">{report.projects.map((project, index) => <article key={project.id}><div className="project-status-field"><span>Status</span><select value={project.status} onChange={(event) => updateProject(index, "status", event.target.value as "A" | "C")}><option value="A">A · Active</option><option value="C">C · Closed</option></select></div><label className="project-name"><span>Project / Description · lấy từ Sản phẩm / ứng dụng</span><input value={project.projectName} onChange={(event) => updateProject(index, "projectName", event.target.value)}/></label><label><span>Customer</span><input value={project.customer} onChange={(event) => updateProject(index, "customer", event.target.value)}/></label><label><span>Project Lead</span><input value={project.projectLead} onChange={(event) => updateProject(index, "projectLead", event.target.value)}/></label><div className="project-dates"><label><span>Start Date</span><input type="date" value={project.startDate} onChange={(event) => updateProject(index, "startDate", event.target.value)}/></label><label><span>Preliminary End</span><input type="date" value={project.preliminaryEndDate} onChange={(event) => updateProject(index, "preliminaryEndDate", event.target.value)}/></label><label><span>Adjusted End</span><input type="date" value={project.adjustedEndDate} onChange={(event) => updateProject(index, "adjustedEndDate", event.target.value)}/></label></div><label className="project-comments"><span>Comments / Kết quả trong tuần</span><textarea rows={4} value={project.comments} onChange={(event) => updateProject(index, "comments", event.target.value)}/></label><button className="project-remove" aria-label="Xóa dòng" onClick={() => setReport({ ...report, projects: report.projects.filter((_item, itemIndex) => itemIndex !== index) })}>×</button></article>)}</div>}</section>
    <div className="weekly-savebar"><span>Dữ liệu được lưu theo từng tuần; Thứ Sáu bạn chọn “Hoàn thành” rồi xuất Excel.</span><div><button className="secondary-button" disabled={saving} onClick={() => void save("Draft")}>Lưu nháp</button><button className="primary-button" disabled={saving} onClick={() => void save("Submitted")}>Hoàn thành báo cáo</button></div></div>
  </>;
}
