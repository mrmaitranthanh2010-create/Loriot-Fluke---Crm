"use client";

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ACCOUNT_TYPES, LEAD_STATUSES, type Lead } from "@/lib/crm";
import { EmailOutreachPanel } from "@/app/email-outreach-panel";

export type LeadDraft = Omit<Lead, "createdAt" | "updatedAt" | "convertedOpportunityId" | "convertedAt">;

const today = () => new Date().toISOString().slice(0, 10);
const emptyLead = (): LeadDraft => ({
  id: "",
  companyName: "",
  website: "",
  industry: "",
  accountType: "End-User",
  contactName: "",
  title: "",
  email: "",
  phone: "",
  source: "Email Outbound",
  lastEmailDate: "",
  status: "Chưa gửi",
  nextFollowUpDate: "",
  emailSubject: "",
  replyNotes: "",
  notes: "",
  owner: "Mai Trần Thành",
  emailOptOut: false,
});

const fromLead = (lead: Lead): LeadDraft => ({
  id: lead.id,
  companyName: lead.companyName,
  website: lead.website,
  industry: lead.industry,
  accountType: lead.accountType,
  contactName: lead.contactName,
  title: lead.title,
  email: lead.email,
  phone: lead.phone,
  source: lead.source,
  lastEmailDate: lead.lastEmailDate,
  status: lead.status,
  nextFollowUpDate: lead.nextFollowUpDate,
  emailSubject: lead.emailSubject,
  replyNotes: lead.replyNotes,
  notes: lead.notes,
  owner: lead.owner,
  emailOptOut: lead.emailOptOut,
});

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const shortDate = (value: string) => value
  ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`))
  : "—";

type LeadWorkspaceTab = "leads" | "campaigns" | "templates" | "history" | "files";

const LEAD_WORKSPACE_TABS: readonly { id: LeadWorkspaceTab; label: string; description: string }[] = [
  { id: "leads", label: "Danh sách Lead", description: "Tìm kiếm, lọc và cập nhật khách hàng" },
  { id: "campaigns", label: "Chiến dịch", description: "Tạo, kích hoạt và theo dõi lịch gửi" },
  { id: "templates", label: "Kho mẫu mail", description: "24 email theo 6 nhóm ngành" },
  { id: "history", label: "Lịch sử gửi", description: "Email đã gửi và phản hồi" },
  { id: "files", label: "Kho tệp", description: "Hình ảnh và tài liệu đính kèm" },
];

export function LeadView({ leads, saving, onSave, onDelete, onConvert, onRefresh, onImport }: {
  leads: Lead[];
  saving: boolean;
  onSave: (lead: LeadDraft) => Promise<boolean>;
  onDelete: (lead: Lead) => Promise<void>;
  onConvert: (lead: Lead) => void;
  onRefresh: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
}) {
  const [draft, setDraft] = useState<LeadDraft>(emptyLead());
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Tất cả trạng thái");
  const [workspaceTab, setWorkspaceTab] = useState<LeadWorkspaceTab>("leads");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const importInputRef = useRef<HTMLInputElement>(null);
  const query = normalized(search.trim());
  const filtered = useMemo(() => leads.filter((lead) => {
    const matchesText = !query || normalized([
      lead.companyName, lead.contactName, lead.email, lead.phone, lead.industry, lead.source, lead.notes, lead.replyNotes,
    ].join(" ")).includes(query);
    return matchesText && (status === "Tất cả trạng thái" || lead.status === status);
  }), [leads, query, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleLeads = filtered.slice(pageStart, pageStart + pageSize);
  const dueToday = today();
  const due = leads.filter((lead) => lead.status !== "Đã chuyển cơ hội" && lead.nextFollowUpDate && lead.nextFollowUpDate <= dueToday).length;
  const replied = leads.filter((lead) => lead.status === "Có phản hồi").length;
  const converted = leads.filter((lead) => lead.status === "Đã chuyển cơ hội").length;

  const showCreate = () => { setDraft(emptyLead()); setOpen(true); };
  const showEdit = (lead: Lead) => { setDraft(fromLead(lead)); setOpen(true); };
  const update = <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) => setDraft({ ...draft, [key]: value });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSave(draft)) setOpen(false);
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await onImport(file);
  };

  return <>
    <div className="page-header"><div><span>LEAD & EMAIL OUTBOUND</span><h1>Lead tìm kiếm khách hàng</h1><p>Lưu danh sách gửi email riêng; chỉ Lead đủ tín hiệu mới được chuyển vào Pipeline và báo cáo.</p></div><div className="lead-header-actions"><input ref={importInputRef} className="lead-import-input" type="file" accept=".xlsx" onChange={importFile}/><button className="secondary-button" disabled={saving} onClick={() => importInputRef.current?.click()}>↑ Nhập Excel</button><button className="primary-button" onClick={showCreate}>＋ Thêm Lead</button></div></div>
    <section className="lead-rule"><strong>Vùng làm việc riêng</strong><span>Email tìm kiếm hàng loạt không tự tạo cơ hội, không tạo báo giá và không xuất hiện trong báo cáo tuần.</span></section>
    <nav className="lead-workspace-tabs" aria-label="Không gian Lead và Email">
      {LEAD_WORKSPACE_TABS.map((tab) => <button
        key={tab.id}
        type="button"
        className={workspaceTab === tab.id ? "active" : ""}
        aria-current={workspaceTab === tab.id ? "page" : undefined}
        onClick={() => setWorkspaceTab(tab.id)}
      ><strong>{tab.label}</strong><span>{tab.description}</span></button>)}
    </nav>

    {workspaceTab !== "leads" && <EmailOutreachPanel leads={leads} onRefresh={onRefresh} section={workspaceTab}/>}

    {workspaceTab === "leads" && <><section className="lead-metrics">
      <article><span>Tổng Lead</span><strong>{leads.length}</strong><small>Danh sách đang lưu</small></article>
      <article><span>Cần Follow-up</span><strong>{due}</strong><small>Đến hạn hoặc quá hạn</small></article>
      <article><span>Có phản hồi</span><strong>{replied}</strong><small>Có thể sàng lọc nhu cầu</small></article>
      <article><span>Đã vào cơ hội</span><strong>{converted}</strong><small>Đã chuyển sang CRM</small></article>
    </section>
    <div className="filter-bar lead-filter"><label className="filter-search"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Tìm công ty, người liên hệ, email..."/></label><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option>Tất cả trạng thái</option>{LEAD_STATUSES.map((item) => <option key={item}>{item}</option>)}</select><span className="result-count">{filtered.length} Lead</span></div>
    <section className="panel records-panel lead-panel">{filtered.length === 0 ? <div className="empty-state"><div className="empty-icon">✉</div><strong>Chưa có Lead phù hợp</strong><p>Thêm Lead đầu tiên hoặc thay đổi điều kiện tìm kiếm.</p></div> : <><div className="table-scroll"><table><thead><tr><th className="stt-column">STT</th><th>Công ty / người liên hệ</th><th>Email / điện thoại</th><th>Trạng thái</th><th>Email gần nhất</th><th>Follow-up tiếp theo</th><th>Ghi nhận phản hồi</th><th>Thao tác</th></tr></thead><tbody>{visibleLeads.map((lead, index) => <tr key={lead.id}><td><strong>{pageStart + index + 1}</strong></td><td><strong>{lead.companyName}</strong><span>{[lead.contactName, lead.title].filter(Boolean).join(" · ") || lead.accountType}</span></td><td><strong>{lead.email || "—"}</strong><span>{lead.phone || lead.source || "—"}</span></td><td><span className={`lead-status lead-${lead.status.replaceAll(" ", "-").toLowerCase()}`}>{lead.status}</span></td><td><strong>{shortDate(lead.lastEmailDate)}</strong><span>{lead.emailSubject || "Chưa ghi tiêu đề"}</span></td><td><strong className={lead.nextFollowUpDate && lead.nextFollowUpDate <= dueToday && lead.status !== "Đã chuyển cơ hội" ? "lead-overdue" : ""}>{shortDate(lead.nextFollowUpDate)}</strong><span>{lead.nextFollowUpDate ? "Ngày cần xử lý" : "Chưa lên lịch"}</span></td><td><strong>{lead.replyNotes || "—"}</strong><span>{lead.notes}</span></td><td><div className="lead-actions"><button className="secondary-button" onClick={() => showEdit(lead)}>Sửa</button>{lead.status !== "Đã chuyển cơ hội" && <button className="primary-button" onClick={() => onConvert(lead)}>Chuyển cơ hội</button>}<button className="lead-delete" aria-label={`Xóa Lead ${lead.companyName}`} onClick={() => void onDelete(lead)}>×</button></div></td></tr>)}</tbody></table></div><footer className="table-pagination"><span>Hiển thị {pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)} trong {filtered.length} Lead</span><label>Số dòng<select aria-label="Số Lead mỗi trang" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><div><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Trước</button><strong>{currentPage} / {pageCount}</strong><button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Sau →</button></div></footer></>}</section></>}

    {open && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><div className={`modal lead-modal ${draft.id ? "is-edit" : "is-create"}`} role="dialog" aria-modal="true" aria-label={draft.id ? "Cập nhật Lead" : "Thêm Lead"}><header className="modal-header"><div><span>{draft.id || "LEAD MỚI"}</span><h2>{draft.id ? "Cập nhật Lead" : "Thêm Lead tìm kiếm"}</h2><p>Thông tin này nằm ngoài Pipeline cho đến khi bạn chủ động chuyển thành cơ hội.</p></div><button className="modal-close" onClick={() => setOpen(false)} aria-label="Đóng">×</button></header><form onSubmit={submit} autoComplete="off"><div className="modal-body"><section className="form-section"><div className="section-title"><div>1</div><span><strong>Công ty và người liên hệ</strong><small>Lead profile</small></span></div><div className="form-grid">
      <label className="form-field"><span>Tên công ty <b>*</b></span><input required value={draft.companyName} onChange={(event) => update("companyName", event.target.value)}/></label>
      <label className="form-field"><span>Loại khách hàng</span><select value={draft.accountType} onChange={(event) => update("accountType", event.target.value)}>{ACCOUNT_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="form-field"><span>Ngành</span><input value={draft.industry} onChange={(event) => update("industry", event.target.value)}/></label>
      <label className="form-field"><span>Website</span><input value={draft.website} onChange={(event) => update("website", event.target.value)} placeholder="https://..."/></label>
      <label className="form-field"><span>Người liên hệ</span><input value={draft.contactName} onChange={(event) => update("contactName", event.target.value)}/></label>
      <label className="form-field"><span>Chức danh</span><input value={draft.title} onChange={(event) => update("title", event.target.value)}/></label>
      <label className="form-field"><span>Email</span><input type="email" value={draft.email} onChange={(event) => update("email", event.target.value)}/></label>
      <label className="form-field"><span>Điện thoại</span><input value={draft.phone} onChange={(event) => update("phone", event.target.value)}/></label>
    </div></section><section className="form-section"><div className="section-title"><div>2</div><span><strong>Email Outbound và Follow-up</strong><small>Prospecting history</small></span></div><div className="form-grid">
      <label className="form-field"><span>Nguồn Lead</span><input value={draft.source} onChange={(event) => update("source", event.target.value)} placeholder="Website, triển lãm, giới thiệu..."/></label>
      <label className="form-field"><span>Trạng thái</span><select value={draft.status} disabled={draft.status === "Đã chuyển cơ hội"} onChange={(event) => update("status", event.target.value as LeadDraft["status"])}>{LEAD_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="form-field checkbox-field"><input type="checkbox" checked={draft.emailOptOut} onChange={(event) => update("emailOptOut", event.target.checked)}/><span>Không gửi email tự động cho Lead này</span></label>
      <label className="form-field"><span>Ngày gửi email gần nhất</span><input type="date" value={draft.lastEmailDate} onChange={(event) => update("lastEmailDate", event.target.value)}/></label>
      <label className="form-field"><span>Ngày Follow-up tiếp theo</span><input type="date" value={draft.nextFollowUpDate} onChange={(event) => update("nextFollowUpDate", event.target.value)}/></label>
      <label className="form-field field-wide"><span>Tiêu đề / chiến dịch email</span><input value={draft.emailSubject} onChange={(event) => update("emailSubject", event.target.value)} placeholder="Ví dụ: Giải pháp kiểm tra điện Fluke cho nhà máy"/></label>
      <label className="form-field field-wide"><span>Phản hồi của khách</span><textarea rows={3} value={draft.replyNotes} onChange={(event) => update("replyNotes", event.target.value)} placeholder="Khách phản hồi gì, ai là người phù hợp, có tín hiệu nhu cầu hay chưa..."/></label>
      <label className="form-field field-wide"><span>Ghi chú nội bộ</span><textarea rows={3} value={draft.notes} onChange={(event) => update("notes", event.target.value)}/></label>
    </div></section></div><footer className="modal-footer"><span>Lead chưa chuyển đổi sẽ không xuất hiện trong báo cáo tuần.</span><div><button type="button" className="secondary-button modal-cancel" onClick={() => setOpen(false)}>Hủy</button><button type="submit" className="primary-button save-button" disabled={saving}>{saving ? "Đang lưu..." : "Lưu Lead"}</button></div></footer></form></div></div>}
  </>;
}
