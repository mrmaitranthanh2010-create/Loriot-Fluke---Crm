"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { EmailMessageLog, EmailSettingsPublic, Lead } from "@/lib/crm";

type EmailPayload = {
  settings: EmailSettingsPublic;
  messages: EmailMessageLog[];
  result?: Record<string, unknown>;
  error?: string;
};

type SettingsDraft = EmailSettingsPublic & { password: string };

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const displayTime = (value: string) => value
  ? new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
  : "—";

async function emailRequest(body?: Record<string, unknown>) {
  const response = await fetch("/api/email", body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : { cache: "no-store" });
  const data = await response.json() as EmailPayload;
  if (!response.ok) throw new Error(data.error || "Không thể xử lý email.");
  return data;
}

export function EmailOutreachPanel({ leads, onRefresh }: {
  leads: Lead[];
  onRefresh: () => Promise<void>;
}) {
  const [data, setData] = useState<EmailPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [followUpDays, setFollowUpDays] = useState(4);

  useEffect(() => {
    let active = true;
    emailRequest()
      .then((next) => { if (active) setData(next); })
      .catch((error: unknown) => {
        if (!active) return;
        setIsError(true);
        setFeedback(error instanceof Error ? error.message : "Không thể tải email.");
      });
    return () => { active = false; };
  }, []);

  const showFeedback = (message: string, error = false) => {
    setIsError(error);
    setFeedback(message);
  };

  const runAction = async (action: string, success: (payload: EmailPayload) => string) => {
    setBusy(true);
    setFeedback("");
    try {
      const next = await emailRequest({ action });
      setData(next);
      showFeedback(success(next));
      await onRefresh();
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Không thể xử lý email.", true);
    } finally {
      setBusy(false);
    }
  };

  const openSettings = () => {
    if (!data) return;
    setSettingsDraft({ ...data.settings, password: "" });
    setSettingsOpen(true);
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!settingsDraft) return;
    setBusy(true);
    setFeedback("");
    try {
      const next = await emailRequest({ action: "saveSettings", ...settingsDraft });
      setData(next);
      setSettingsOpen(false);
      showFeedback("Đã lưu tài khoản email an toàn trong CRM.");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Không thể lưu tài khoản email.", true);
    } finally {
      setBusy(false);
    }
  };

  const openCompose = () => {
    if (!data) return;
    setSelectedIds([]);
    setRecipientSearch("");
    setSubject(data.settings.defaultSubject);
    setBody(data.settings.defaultBody);
    setFollowUpDays(4);
    setComposeOpen(true);
  };

  const eligibleLeads = useMemo(() => leads.filter((lead) => {
    if (!lead.email || lead.status === "Đã chuyển cơ hội") return false;
    const query = normalize(recipientSearch.trim());
    return !query || normalize(`${lead.companyName} ${lead.contactName} ${lead.email}`).includes(query);
  }), [leads, recipientSearch]);

  const toggleLead = (leadId: string) => {
    setSelectedIds((current) => {
      if (current.includes(leadId)) return current.filter((id) => id !== leadId);
      if (current.length >= 10) {
        showFeedback("Mỗi lần chỉ chọn tối đa 10 Lead.", true);
        return current;
      }
      return [...current, leadId];
    });
  };

  const sendEmails = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    try {
      const next = await emailRequest({
        action: "sendLeads",
        leadIds: selectedIds,
        subject,
        body,
        followUpDays,
      });
      setData(next);
      setComposeOpen(false);
      const sent = Number(next.result?.sent || 0);
      const failed = Number(next.result?.failed || 0);
      showFeedback(`Đã gửi ${sent} email${failed ? `, ${failed} email lỗi` : ""}. CRM đã tự lên lịch Follow-up.`);
      await onRefresh();
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Không thể gửi email.", true);
    } finally {
      setBusy(false);
    }
  };

  const leadById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads]);
  const latestMessages = data?.messages.slice(0, 8) ?? [];

  return <>
    <section className={`email-connection ${data?.settings.configured ? "is-connected" : ""}`}>
      <div className="email-connection-icon">✉</div>
      <div className="email-connection-main">
        <span>EMAIL CÔNG TY</span>
        <strong>{data?.settings.fromEmail || "Đang tải cấu hình..."}</strong>
        <small>{data?.settings.configured
          ? "Đã kết nối an toàn · Có thể gửi email và kiểm tra phản hồi"
          : "Chưa nhập mật khẩu email vào CRM"}</small>
      </div>
      <div className="email-connection-actions">
        <button className="secondary-button" disabled={!data || busy} onClick={openSettings}>Cấu hình</button>
        <button className="secondary-button" disabled={!data?.settings.configured || busy} onClick={() => void runAction("testConnection", () => "Đã gửi email thử vào chính hộp thư của anh.")}>Gửi thử</button>
        <button className="secondary-button" disabled={!data?.settings.configured || busy} onClick={() => void runAction("syncReplies", (next) => `Đã kiểm tra hộp thư, ghi nhận ${Number(next.result?.added || 0)} phản hồi mới.`)}>Kiểm tra phản hồi</button>
        <button className="primary-button" disabled={!data?.settings.configured || busy} onClick={openCompose}>Soạn email cho Lead</button>
      </div>
    </section>

    {feedback && <div className={`email-feedback ${isError ? "error" : "success"}`}>{feedback}</div>}

    {latestMessages.length > 0 && <section className="email-history panel">
      <header><div><span>HOẠT ĐỘNG EMAIL GẦN ĐÂY</span><strong>Lịch sử gửi và phản hồi</strong></div><small>{data?.messages.length || 0} email được lưu</small></header>
      <div className="email-history-list">{latestMessages.map((message) => {
        const lead = leadById.get(message.leadId);
        return <article key={message.id}>
          <span className={`email-direction ${message.direction}`}>{message.direction === "inbound" ? "↙ Nhận" : "↗ Gửi"}</span>
          <div><strong>{lead?.companyName || message.recipientEmail || message.senderEmail}</strong><span>{message.subject}</span></div>
          <div><strong>{message.direction === "inbound" ? message.senderEmail : message.recipientEmail}</strong><span>{displayTime(message.receivedAt || message.sentAt || message.createdAt)}</span></div>
          <span className={`email-log-status ${message.status.toLowerCase()}`}>{message.status === "Sent" ? "Đã gửi" : message.status === "Received" ? "Đã nhận" : "Lỗi"}</span>
        </article>;
      })}</div>
    </section>}

    {settingsOpen && settingsDraft && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <div className="modal email-settings-modal" role="dialog" aria-modal="true" aria-label="Cấu hình email công ty">
        <header className="modal-header"><div><span>KẾT NỐI MẮT BÃO</span><h2>Cấu hình email công ty</h2><p>Mật khẩu được mã hóa trước khi lưu và không bao giờ hiển thị lại.</p></div><button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="Đóng">×</button></header>
        <form onSubmit={saveSettings} autoComplete="off"><div className="modal-body"><div className="form-grid">
          <label className="form-field"><span>Email gửi</span><input type="email" required value={settingsDraft.fromEmail} onChange={(event) => setSettingsDraft({ ...settingsDraft, fromEmail: event.target.value })}/></label>
          <label className="form-field"><span>Tên người gửi</span><input required value={settingsDraft.fromName} onChange={(event) => setSettingsDraft({ ...settingsDraft, fromName: event.target.value })}/></label>
          <label className="form-field"><span>Tên đăng nhập</span><input type="email" required value={settingsDraft.username} onChange={(event) => setSettingsDraft({ ...settingsDraft, username: event.target.value })}/></label>
          <label className="form-field"><span>Mật khẩu email</span><input type="password" value={settingsDraft.password} onChange={(event) => setSettingsDraft({ ...settingsDraft, password: event.target.value })} placeholder={settingsDraft.configured ? "Để trống nếu không đổi" : "Nhập mật khẩu hiện tại"}/></label>
          <label className="form-field"><span>Máy chủ gửi (SMTP)</span><input required value={settingsDraft.smtpHost} onChange={(event) => setSettingsDraft({ ...settingsDraft, smtpHost: event.target.value })}/></label>
          <label className="form-field"><span>Cổng / bảo mật SMTP</span><div className="email-port-row"><input type="number" required value={settingsDraft.smtpPort} onChange={(event) => setSettingsDraft({ ...settingsDraft, smtpPort: Number(event.target.value) })}/><select value={settingsDraft.smtpSecurity} onChange={(event) => setSettingsDraft({ ...settingsDraft, smtpSecurity: event.target.value as "ssl" | "starttls" })}><option value="ssl">SSL</option><option value="starttls">STARTTLS</option></select></div></label>
          <label className="form-field"><span>Máy chủ nhận (IMAP)</span><input required value={settingsDraft.imapHost} onChange={(event) => setSettingsDraft({ ...settingsDraft, imapHost: event.target.value })}/></label>
          <label className="form-field"><span>Cổng IMAP</span><input type="number" required value={settingsDraft.imapPort} onChange={(event) => setSettingsDraft({ ...settingsDraft, imapPort: Number(event.target.value) })}/></label>
          <label className="form-field field-wide"><span>Tiêu đề mặc định</span><input required value={settingsDraft.defaultSubject} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultSubject: event.target.value })}/></label>
          <label className="form-field field-wide"><span>Nội dung mặc định</span><textarea rows={10} required value={settingsDraft.defaultBody} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultBody: event.target.value })}/></label>
        </div><p className="email-token-help">Có thể dùng: {"{{companyName}}"}, {"{{contactName}}"}, {"{{salutation}}"}, {"{{title}}"}, {"{{industry}}"}</p></div>
        <footer className="modal-footer"><span>Cấu hình mặc định đã điền theo máy chủ pro43.emailserver.vn.</span><div><button type="button" className="secondary-button" onClick={() => setSettingsOpen(false)}>Hủy</button><button className="primary-button" disabled={busy}>{busy ? "Đang lưu..." : "Lưu cấu hình"}</button></div></footer></form>
      </div>
    </div>}

    {composeOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setComposeOpen(false); }}>
      <div className="modal email-compose-modal" role="dialog" aria-modal="true" aria-label="Soạn email cho Lead">
        <header className="modal-header"><div><span>EMAIL OUTBOUND</span><h2>Soạn email cho Lead</h2><p>Chọn tối đa 10 người nhận. Mỗi Lead nhận một email riêng đã cá nhân hóa.</p></div><button className="modal-close" onClick={() => setComposeOpen(false)} aria-label="Đóng">×</button></header>
        <form onSubmit={sendEmails}><div className="modal-body email-compose-grid">
          <section className="email-recipient-picker"><header><strong>Người nhận</strong><span>{selectedIds.length}/10 đã chọn</span></header><input aria-label="Tìm Lead nhận email" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="Gõ tên công ty, người liên hệ hoặc email..."/><div>{eligibleLeads.length === 0 ? <p>Không có Lead có email phù hợp.</p> : eligibleLeads.map((lead) => <label key={lead.id} aria-label={`Chọn Lead ${lead.companyName}`} className={selectedIds.includes(lead.id) ? "is-selected" : ""}><input type="checkbox" checked={selectedIds.includes(lead.id)} onChange={() => toggleLead(lead.id)}/><span><strong>{lead.companyName}</strong><small>{lead.contactName || "Chưa có người liên hệ"} · {lead.email}</small></span></label>)}</div></section>
          <section className="email-composer"><label className="form-field"><span>Tiêu đề</span><input required value={subject} onChange={(event) => setSubject(event.target.value)}/></label><label className="form-field"><span>Nội dung</span><textarea rows={16} required value={body} onChange={(event) => setBody(event.target.value)}/></label><label className="email-followup-days"><span>Tự nhắc Follow-up sau</span><input type="number" min={1} max={30} value={followUpDays} onChange={(event) => setFollowUpDays(Number(event.target.value))}/><strong>ngày</strong></label><p className="email-token-help">Tự thay nội dung theo từng Lead: {"{{companyName}}"}, {"{{contactName}}"}, {"{{salutation}}"}, {"{{title}}"}, {"{{industry}}"}</p></section>
        </div><footer className="modal-footer"><span>Email tìm kiếm vẫn nằm ngoài Pipeline và báo cáo tuần.</span><div><button type="button" className="secondary-button" onClick={() => setComposeOpen(false)}>Hủy</button><button className="primary-button" disabled={busy || selectedIds.length === 0}>{busy ? "Đang gửi..." : `Gửi ${selectedIds.length} email`}</button></div></footer></form>
      </div>
    </div>}
  </>;
}
