"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { EmailAsset, EmailMessageLog, EmailSettingsPublic, Lead } from "@/lib/crm";
import { LORIOT_LOGO_DATA_URL } from "@/lib/email-branding";

type EmailPayload = {
  settings: EmailSettingsPublic;
  messages: EmailMessageLog[];
  assets: EmailAsset[];
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

const displayBytes = (value: number) => value >= 1024 * 1024
  ? `${(value / (1024 * 1024)).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`
  : `${Math.max(1, Math.round(value / 1024)).toLocaleString("vi-VN")} KB`;

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

async function emailFileRequest(input: RequestInit) {
  const response = await fetch("/api/email-files", input);
  const data = await response.json() as { assets?: EmailAsset[]; error?: string };
  if (!response.ok) throw new Error(data.error || "Không thể xử lý tệp email.");
  return data.assets ?? [];
}

export function EmailOutreachPanel({ leads, onRefresh }: {
  leads: Lead[];
  onRefresh: () => Promise<void>;
}) {
  const [data, setData] = useState<EmailPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeError, setComposeError] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [followUpDays, setFollowUpDays] = useState(4);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setSettingsError("");
    setSettingsOpen(true);
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!settingsDraft) return;
    setSettingsError("");
    if (!settingsDraft.fromEmail.trim() || !settingsDraft.fromName.trim() || !settingsDraft.username.trim()) {
      setSettingsError("Vui lòng điền đầy đủ email gửi, tên người gửi và tên đăng nhập.");
      return;
    }
    if (!settingsDraft.configured && !settingsDraft.password) {
      setSettingsError("Vui lòng nhập mật khẩu email ở lần kết nối đầu tiên.");
      return;
    }
    if (!settingsDraft.smtpHost.trim() || !settingsDraft.imapHost.trim()
      || settingsDraft.smtpPort < 1 || settingsDraft.imapPort < 1) {
      setSettingsError("Thông tin máy chủ email hoặc cổng kết nối chưa đầy đủ.");
      return;
    }
    if (!settingsDraft.defaultSubject.trim() || !settingsDraft.defaultBody.trim()) {
      setSettingsError("Vui lòng điền tiêu đề và nội dung email mặc định.");
      return;
    }
    setBusy(true);
    setFeedback("");
    try {
      const next = await emailRequest({ action: "saveSettings", ...settingsDraft });
      setData(next);
      setSettingsOpen(false);
      showFeedback("Đã lưu tài khoản email an toàn trong CRM.");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Không thể lưu tài khoản email.");
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
    setSelectedAssetIds([]);
    setComposeError("");
    setComposeOpen(true);
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setFeedback("");
    try {
      let assets = data?.assets ?? [];
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} vượt quá giới hạn 10 MB.`);
        const form = new FormData();
        form.append("file", file);
        assets = await emailFileRequest({ method: "POST", body: form });
      }
      setData((current) => current ? { ...current, assets } : current);
      showFeedback(`Đã thêm ${files.length} tệp vào kho email.`);
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Không thể tải tệp lên.", true);
    } finally {
      setUploading(false);
    }
  };

  const deleteAsset = async (asset: EmailAsset) => {
    if (!window.confirm(`Xóa “${asset.fileName}” khỏi kho tệp email?`)) return;
    setUploading(true);
    setFeedback("");
    try {
      const assets = await emailFileRequest({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asset.id }),
      });
      setData((current) => current ? { ...current, assets } : current);
      setSelectedAssetIds((current) => current.filter((id) => id !== asset.id));
      showFeedback("Đã xóa tệp khỏi kho email.");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Không thể xóa tệp.", true);
    } finally {
      setUploading(false);
    }
  };

  const toggleAsset = (asset: EmailAsset) => {
    setComposeError("");
    setSelectedAssetIds((current) => {
      if (current.includes(asset.id)) return current.filter((id) => id !== asset.id);
      if (current.length >= 5) {
        setComposeError("Mỗi email chỉ được chọn tối đa 5 tệp hoặc hình ảnh.");
        return current;
      }
      const assets = data?.assets ?? [];
      const next = [...current, asset.id];
      const total = assets.filter((item) => next.includes(item.id)).reduce((sum, item) => sum + item.sizeBytes, 0);
      if (total > 15 * 1024 * 1024) {
        setComposeError("Tổng dung lượng tệp gửi kèm không được vượt quá 15 MB.");
        return current;
      }
      return next;
    });
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
    setComposeError("");
    try {
      const next = await emailRequest({
        action: "sendLeads",
        leadIds: selectedIds,
        subject,
        body,
        followUpDays,
        assetIds: selectedAssetIds,
      });
      setData(next);
      setComposeOpen(false);
      const sent = Number(next.result?.sent || 0);
      const failed = Number(next.result?.failed || 0);
      showFeedback(`Đã gửi ${sent} email${failed ? `, ${failed} email lỗi` : ""}. CRM đã tự lên lịch Follow-up.`);
      await onRefresh();
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "Không thể gửi email.");
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

    <section className="email-file-library panel">
      <header>
        <div>
          <span>KHO TỆP EMAIL</span>
          <strong>Ảnh nội dung & tài liệu đính kèm</strong>
          <small>Ảnh được chèn vào nội dung email; tài liệu được gửi dưới dạng tệp đính kèm.</small>
        </div>
        <div className="email-file-actions">
          <small>{data?.assets.length || 0} tệp · tối đa 10 MB/tệp</small>
          <input
            ref={fileInputRef}
            className="email-file-input"
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip"
            onChange={uploadFiles}
          />
          <button className="primary-button" disabled={!data || uploading} onClick={() => fileInputRef.current?.click()}>
            {uploading ? "Đang xử lý..." : "+ Tải tệp từ máy"}
          </button>
        </div>
      </header>
      <div className="email-storage-note">
        <strong>Lưu trữ an toàn:</strong>
        <span>File gốc nằm trong Cloudflare R2; D1 chỉ giữ tên, loại và dung lượng để CRM quản lý.</span>
      </div>
      {!data?.assets.length ? <div className="email-file-empty">
        <strong>Kho tệp đang trống</strong>
        <span>Anh tải ảnh giới thiệu sản phẩm, catalogue, bảng thông số hoặc tài liệu cần gửi cho khách lên đây.</span>
      </div> : <div className="email-file-grid">{data.assets.map((asset) => <article key={asset.id}>
        <a className={`email-file-preview ${asset.fileKind}`} href={`/api/email-files?id=${encodeURIComponent(asset.id)}`} target="_blank" rel="noreferrer" aria-label={`Xem ${asset.fileName}`}>
          {asset.fileKind === "image"
            ? <span className="email-file-image" style={{ backgroundImage: `url(/api/email-files?id=${encodeURIComponent(asset.id)})` }}/>
            : <span>{asset.fileName.split(".").pop()?.toUpperCase() || "FILE"}</span>}
        </a>
        <div className="email-file-meta">
          <strong title={asset.fileName}>{asset.fileName}</strong>
          <span>{asset.fileKind === "image" ? "Chèn trong nội dung" : "Tệp đính kèm"} · {displayBytes(asset.sizeBytes)}</span>
        </div>
        <div className="email-file-row-actions">
          <a href={`/api/email-files?id=${encodeURIComponent(asset.id)}&download=1`} aria-label={`Tải ${asset.fileName}`}>↓</a>
          <button type="button" disabled={uploading} onClick={() => void deleteAsset(asset)} aria-label={`Xóa ${asset.fileName}`}>×</button>
        </div>
      </article>)}</div>}
    </section>

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
        <form onSubmit={saveSettings} autoComplete="off" noValidate><div className="modal-body"><div className="form-grid">
          <label className="form-field"><span>Email gửi</span><input type="email" required value={settingsDraft.fromEmail} onChange={(event) => setSettingsDraft({ ...settingsDraft, fromEmail: event.target.value })}/></label>
          <label className="form-field"><span>Tên người gửi</span><input required value={settingsDraft.fromName} onChange={(event) => setSettingsDraft({ ...settingsDraft, fromName: event.target.value })}/></label>
          <label className="form-field"><span>Tên đăng nhập</span><input type="email" required value={settingsDraft.username} onChange={(event) => setSettingsDraft({ ...settingsDraft, username: event.target.value })}/></label>
          <label className="form-field"><span>Mật khẩu email{!settingsDraft.configured && <b>*</b>}</span><input type="password" required={!settingsDraft.configured} autoComplete="new-password" value={settingsDraft.password} onChange={(event) => { setSettingsDraft({ ...settingsDraft, password: event.target.value }); setSettingsError(""); }} placeholder={settingsDraft.configured ? "Để trống nếu không đổi" : "Bắt buộc ở lần kết nối đầu tiên"}/><small>{settingsDraft.configured ? "Để trống nếu anh không muốn đổi mật khẩu." : "Nhập mật khẩu đang dùng trong Apple Mail/Roundcube."}</small></label>
          <label className="form-field"><span>Máy chủ gửi (SMTP)</span><input required value={settingsDraft.smtpHost} onChange={(event) => setSettingsDraft({ ...settingsDraft, smtpHost: event.target.value })}/></label>
          <label className="form-field"><span>Cổng / bảo mật SMTP</span><div className="email-port-row"><input type="number" required value={settingsDraft.smtpPort} onChange={(event) => setSettingsDraft({ ...settingsDraft, smtpPort: Number(event.target.value) })}/><select value={settingsDraft.smtpSecurity} onChange={(event) => setSettingsDraft({ ...settingsDraft, smtpSecurity: event.target.value as "ssl" | "starttls" })}><option value="ssl">SSL</option><option value="starttls">STARTTLS</option></select></div></label>
          <label className="form-field"><span>Máy chủ nhận (IMAP)</span><input required value={settingsDraft.imapHost} onChange={(event) => setSettingsDraft({ ...settingsDraft, imapHost: event.target.value })}/></label>
          <label className="form-field"><span>Cổng IMAP</span><input type="number" required value={settingsDraft.imapPort} onChange={(event) => setSettingsDraft({ ...settingsDraft, imapPort: Number(event.target.value) })}/></label>
          <label className="form-field field-wide"><span>Tiêu đề mặc định</span><input required value={settingsDraft.defaultSubject} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultSubject: event.target.value })}/></label>
          <label className="form-field field-wide"><span>Nội dung mặc định</span><textarea rows={10} required value={settingsDraft.defaultBody} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultBody: event.target.value })}/></label>
        </div><p className="email-token-help">Có thể dùng: {"{{companyName}}"}, {"{{contactName}}"}, {"{{salutation}}"}, {"{{title}}"}, {"{{industry}}"}</p>{settingsError && <div className="email-feedback error email-settings-error" role="alert">{settingsError}</div>}</div>
        <footer className="modal-footer"><span>Cấu hình mặc định đã điền theo máy chủ pro43.emailserver.vn.</span><div><button type="button" className="secondary-button" onClick={() => setSettingsOpen(false)}>Hủy</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Đang lưu..." : "Lưu cấu hình"}</button></div></footer></form>
      </div>
    </div>}

    {composeOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setComposeOpen(false); }}>
      <div className="modal email-compose-modal" role="dialog" aria-modal="true" aria-label="Soạn email cho Lead">
        <header className="modal-header"><div><span>EMAIL OUTBOUND</span><h2>Soạn email cho Lead</h2><p>Chọn tối đa 10 người nhận. Mỗi Lead nhận một email riêng đã cá nhân hóa.</p></div><button className="modal-close" onClick={() => setComposeOpen(false)} aria-label="Đóng">×</button></header>
        <form onSubmit={sendEmails}><div className="modal-body email-compose-grid">
          <section className="email-recipient-picker"><header><strong>Người nhận</strong><span>{selectedIds.length}/10 đã chọn</span></header><input aria-label="Tìm Lead nhận email" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="Gõ tên công ty, người liên hệ hoặc email..."/><div>{eligibleLeads.length === 0 ? <p>Không có Lead có email phù hợp.</p> : eligibleLeads.map((lead) => <label key={lead.id} aria-label={`Chọn Lead ${lead.companyName}`} className={selectedIds.includes(lead.id) ? "is-selected" : ""}><input type="checkbox" checked={selectedIds.includes(lead.id)} onChange={() => toggleLead(lead.id)}/><span><strong>{lead.companyName}</strong><small>{lead.contactName || "Chưa có người liên hệ"} · {lead.email}</small></span></label>)}</div></section>
          <section className="email-composer">
            <label className="form-field"><span>Tiêu đề</span><input required value={subject} onChange={(event) => setSubject(event.target.value)}/></label>
            <label className="form-field"><span>Nội dung</span><textarea rows={16} required value={body} onChange={(event) => setBody(event.target.value)}/></label>
            <aside className="email-compose-assets">
              <header><div><strong>Ảnh & tệp gửi kèm</strong><small>Chọn tối đa 5 tệp, tổng không quá 15 MB</small></div><span>{selectedAssetIds.length}/5</span></header>
              {!data?.assets.length ? <p>Kho tệp đang trống. Hãy tải tệp lên trước khi soạn email.</p> : <div>{data.assets.map((asset) => <label key={asset.id} className={selectedAssetIds.includes(asset.id) ? "is-selected" : ""}>
                <input type="checkbox" checked={selectedAssetIds.includes(asset.id)} onChange={() => toggleAsset(asset)}/>
                <span className={`email-asset-mini ${asset.fileKind}`}>{asset.fileKind === "image" ? "ẢNH" : "TỆP"}</span>
                <span><strong title={asset.fileName}>{asset.fileName}</strong><small>{asset.fileKind === "image" ? "Hiển thị trong nội dung" : "Đính kèm email"} · {displayBytes(asset.sizeBytes)}</small></span>
              </label>)}</div>}
            </aside>
            <aside className="email-signature-preview"><span>CHỮ KÝ TỰ ĐỘNG</span><strong>Mai Trần Thành (Mr.)</strong><small>T: (+84) 964 72 72 33 · E: hn.sales3@loriot.com.vn</small><div className="email-signature-logo" role="img" aria-label="Loriot Industrial" style={{ backgroundImage: `url(${LORIOT_LOGO_DATA_URL})` }}/></aside>
            <label className="email-followup-days"><span>Tự nhắc Follow-up sau</span><input type="number" min={1} max={30} value={followUpDays} onChange={(event) => setFollowUpDays(Number(event.target.value))}/><strong>ngày</strong></label>
            <p className="email-token-help">Tự thay nội dung theo từng Lead: {"{{companyName}}"}, {"{{contactName}}"}, {"{{salutation}}"}, {"{{title}}"}, {"{{industry}}"}</p>
            {composeError && <div className="email-feedback error email-compose-error" role="alert">{composeError}</div>}
          </section>
        </div><footer className="modal-footer"><span>Email tìm kiếm vẫn nằm ngoài Pipeline và báo cáo tuần. Ảnh đã chọn sẽ hiện trước chữ ký.</span><div><button type="button" className="secondary-button" onClick={() => setComposeOpen(false)}>Hủy</button><button className="primary-button" disabled={busy || selectedIds.length === 0}>{busy ? "Đang gửi..." : `Gửi ${selectedIds.length} email`}</button></div></footer></form>
      </div>
    </div>}
  </>;
}
