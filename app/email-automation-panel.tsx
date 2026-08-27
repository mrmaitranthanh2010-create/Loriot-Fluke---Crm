"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  EmailAsset,
  EmailAutomationAnalytics,
  EmailAutomationSettings,
  EmailCampaign,
  Lead,
} from "@/lib/crm";

type AutomationPayload = {
  automation: EmailAutomationSettings;
  campaigns: EmailCampaign[];
  analytics: EmailAutomationAnalytics;
  result?: Record<string, unknown>;
  error?: string;
};

type CampaignDraft = {
  name: string;
  objective: string;
  industry: string;
  startDate: string;
  subjectTemplate: string;
  bodyTemplate: string;
  followUpEnabled: boolean;
  followUpDelayDays: number;
  followUpSubjectTemplate: string;
  followUpBodyTemplate: string;
  leadIds: string[];
  assetIds: string[];
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyCampaign = (): CampaignDraft => ({
  name: "",
  objective: "",
  industry: "Nhà máy sản xuất công nghiệp",
  startDate: today(),
  subjectTemplate: "Giải pháp thiết bị đo Fluke cho {{companyName}}",
  bodyTemplate: "",
  followUpEnabled: true,
  followUpDelayDays: 4,
  followUpSubjectTemplate: "Re: Giải pháp thiết bị đo Fluke cho {{companyName}}",
  followUpBodyTemplate: "",
  leadIds: [],
  assetIds: [],
});

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const displayDate = (value: string) => value
  ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`))
  : "—";

const displayTime = (value: string) => value
  ? new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
  : "Chưa chạy";

const campaignStatus = (status: EmailCampaign["status"]) => ({
  Draft: "Bản nháp",
  Active: "Đang chạy",
  Paused: "Tạm dừng",
  Completed: "Hoàn thành",
}[status]);

async function automationRequest(body?: Record<string, unknown>) {
  const response = await fetch("/api/email-automation", body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : { cache: "no-store" });
  const data = await response.json() as AutomationPayload;
  if (!response.ok) throw new Error(data.error || "Không thể xử lý tự động hóa email.");
  return data;
}

export function EmailAutomationPanel({
  leads,
  assets,
  emailConfigured,
  onChanged,
}: {
  leads: Lead[];
  assets: EmailAsset[];
  emailConfigured: boolean;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<AutomationPayload | null>(null);
  const [settings, setSettings] = useState<EmailAutomationSettings | null>(null);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaign());
  const [leadSearch, setLeadSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;
    automationRequest().then((next) => {
      if (!active) return;
      setData(next);
      setSettings(next.automation);
    }).catch((error: unknown) => {
      if (!active) return;
      setIsError(true);
      setFeedback(error instanceof Error ? error.message : "Không thể tải trung tâm chiến dịch.");
    });
    return () => { active = false; };
  }, []);

  const showFeedback = (message: string, error = false) => {
    setIsError(error);
    setFeedback(message);
  };

  const updatePayload = (next: AutomationPayload) => {
    setData(next);
    setSettings(next.automation);
  };

  const saveSettings = async () => {
    if (!settings) return;
    if (settings.enabled && !emailConfigured) {
      showFeedback("Hãy cấu hình và kiểm tra email công ty trước khi bật tự động hóa.", true);
      return;
    }
    if (settings.enabled && !window.confirm(`Bật lịch gửi tự động với giới hạn ${settings.dailyLimit} email/ngày?`)) return;
    setBusy(true);
    try {
      const next = await automationRequest({ action: "saveAutomationSettings", ...settings });
      updatePayload(next);
      showFeedback(settings.enabled ? "Đã bật tự động hóa có kiểm soát." : "Đã tắt toàn bộ lịch gửi tự động.");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Không thể lưu cấu hình tự động hóa.", true);
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    if (!data?.automation.enabled) {
      showFeedback("Tự động hóa đang tắt. Hãy bật trước khi chạy lịch.", true);
      return;
    }
    if (!window.confirm("Chạy lịch ngay có thể gửi email cho các Lead đang đến hạn. Anh xác nhận tiếp tục?")) return;
    setBusy(true);
    try {
      const next = await automationRequest({ action: "runNow" });
      updatePayload(next);
      const sent = Number(next.result?.sent || 0);
      const replies = Number(next.result?.repliesAdded || 0);
      const skipped = typeof next.result?.skipped === "string" ? next.result.skipped : "";
      showFeedback(skipped || `Đã gửi ${sent} email và ghi nhận ${replies} phản hồi mới.`);
      await onChanged();
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Không thể chạy lịch email.", true);
    } finally {
      setBusy(false);
    }
  };

  const eligibleLeads = useMemo(() => leads.filter((lead) => {
    if (!lead.email || lead.emailOptOut || lead.status === "Không nhận email" || lead.status === "Đã chuyển cơ hội") return false;
    const query = normalize(leadSearch.trim());
    return !query || normalize(`${lead.companyName} ${lead.contactName} ${lead.email} ${lead.industry}`).includes(query);
  }), [leadSearch, leads]);

  const openCampaign = () => {
    setDraft(emptyCampaign());
    setLeadSearch("");
    setFormError("");
    setCampaignOpen(true);
  };

  const toggleLead = (id: string) => setDraft((current) => ({
    ...current,
    leadIds: current.leadIds.includes(id)
      ? current.leadIds.filter((item) => item !== id)
      : current.leadIds.length >= 300 ? current.leadIds : [...current.leadIds, id],
  }));

  const toggleAsset = (id: string) => setDraft((current) => {
    if (current.assetIds.includes(id)) return { ...current, assetIds: current.assetIds.filter((item) => item !== id) };
    if (current.assetIds.length >= 5) {
      setFormError("Mỗi chiến dịch chỉ được chọn tối đa 5 tệp.");
      return current;
    }
    return { ...current, assetIds: [...current.assetIds, id] };
  });

  const draftWithAi = async () => {
    if (!draft.objective.trim()) {
      setFormError("Hãy mô tả mục tiêu chiến dịch trước khi yêu cầu AI soạn nội dung.");
      return;
    }
    setAiBusy(true);
    setFormError("");
    try {
      const next = await automationRequest({
        action: "draftCampaignWithAi",
        objective: draft.objective,
        industry: draft.industry,
      });
      setDraft((current) => ({
        ...current,
        name: String(next.result?.name || current.name),
        subjectTemplate: String(next.result?.subject || current.subjectTemplate),
        bodyTemplate: String(next.result?.body || current.bodyTemplate),
        followUpSubjectTemplate: String(next.result?.followUpSubject || current.followUpSubjectTemplate),
        followUpBodyTemplate: String(next.result?.followUpBody || current.followUpBodyTemplate),
      }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "AI chưa thể soạn chiến dịch.");
    } finally {
      setAiBusy(false);
    }
  };

  const saveCampaignForm = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!draft.leadIds.length) {
      setFormError("Vui lòng chọn ít nhất một Lead.");
      return;
    }
    setBusy(true);
    try {
      const next = await automationRequest({ action: "saveCampaign", ...draft });
      updatePayload(next);
      setCampaignOpen(false);
      showFeedback("Đã lưu chiến dịch ở trạng thái Bản nháp. Email chưa được gửi.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Không thể lưu chiến dịch.");
    } finally {
      setBusy(false);
    }
  };

  const changeCampaignStatus = async (campaign: EmailCampaign, status: "Active" | "Paused") => {
    const prompt = status === "Active"
      ? `Kích hoạt “${campaign.name}”? Hệ thống sẽ gửi theo lịch và tự dừng từng Lead khi có phản hồi.`
      : `Tạm dừng “${campaign.name}”? Các email chưa gửi sẽ được giữ lại.`;
    if (!window.confirm(prompt)) return;
    setBusy(true);
    try {
      const next = await automationRequest({ action: "setCampaignStatus", id: campaign.id, status });
      updatePayload(next);
      showFeedback(status === "Active" ? "Đã kích hoạt chiến dịch." : "Đã tạm dừng chiến dịch.");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Không thể đổi trạng thái chiến dịch.", true);
    } finally {
      setBusy(false);
    }
  };

  const removeCampaign = async (campaign: EmailCampaign) => {
    if (!window.confirm(`Xóa chiến dịch “${campaign.name}”? Lịch sử email đã gửi vẫn được giữ lại.`)) return;
    setBusy(true);
    try {
      const next = await automationRequest({ action: "deleteCampaign", id: campaign.id });
      updatePayload(next);
      showFeedback("Đã xóa chiến dịch.");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Không thể xóa chiến dịch.", true);
    } finally {
      setBusy(false);
    }
  };

  const analytics = data?.analytics;

  return <>
    <section className={`automation-center panel ${data?.automation.enabled ? "is-enabled" : ""}`}>
      <header className="automation-header">
        <div><span>GIAI ĐOẠN 4 · AI & TỰ ĐỘNG HÓA</span><strong>Trung tâm chiến dịch email</strong><small>Mặc định an toàn: giới hạn theo ngày, gửi theo lô và dừng ngay khi khách phản hồi.</small></div>
        <div className="automation-header-actions">
          <span className={`automation-master-state ${data?.automation.enabled ? "on" : "off"}`}>{data?.automation.enabled ? "ĐANG BẬT" : "ĐANG TẮT"}</span>
          <button className="secondary-button" disabled={!data || busy} onClick={openCampaign}>＋ Tạo chiến dịch</button>
          <button className="primary-button" disabled={!data?.automation.enabled || busy} onClick={() => void runNow()}>{busy ? "Đang xử lý..." : "Chạy lịch ngay"}</button>
        </div>
      </header>

      {feedback && <div className={`automation-feedback ${isError ? "error" : "success"}`}>{feedback}</div>}

      <div className="automation-metrics">
        <article><span>Đã gửi hôm nay</span><strong>{analytics?.sentToday || 0}<small>/{data?.automation.dailyLimit || 20}</small></strong><em>Giới hạn toàn hệ thống</em></article>
        <article><span>Tỷ lệ phản hồi</span><strong>{((analytics?.replyRate || 0) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%</strong><em>{analytics?.repliesTotal || 0} phản hồi</em></article>
        <article><span>Lead thành cơ hội</span><strong>{analytics?.convertedLeads || 0}</strong><em>Từ danh sách Lead</em></article>
        <article><span>Đang chờ gửi</span><strong>{analytics?.queuedRecipients || 0}</strong><em>{analytics?.activeCampaigns || 0} chiến dịch hoạt động</em></article>
      </div>

      {settings && <div className="automation-settings">
        <label className="automation-switch"><input aria-label="Cho phép chạy lịch tự động" type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}/><span><strong>Cho phép chạy lịch tự động</strong><small>Chỉ chiến dịch Đang chạy mới được gửi</small></span></label>
        <label><span>Giới hạn/ngày</span><input type="number" min={1} max={50} value={settings.dailyLimit} onChange={(event) => setSettings({ ...settings, dailyLimit: Number(event.target.value) })}/></label>
        <label><span>Mỗi lượt</span><input type="number" min={1} max={5} value={settings.batchSize} onChange={(event) => setSettings({ ...settings, batchSize: Number(event.target.value) })}/></label>
        <label><span>Từ giờ</span><input type="number" min={0} max={22} value={settings.sendStartHour} onChange={(event) => setSettings({ ...settings, sendStartHour: Number(event.target.value) })}/></label>
        <label><span>Đến giờ</span><input type="number" min={1} max={23} value={settings.sendEndHour} onChange={(event) => setSettings({ ...settings, sendEndHour: Number(event.target.value) })}/></label>
        <label className="automation-check"><input type="checkbox" checked={settings.weekdaysOnly} onChange={(event) => setSettings({ ...settings, weekdaysOnly: event.target.checked })}/><span>Chỉ Thứ 2–Thứ 6</span></label>
        <label className="automation-check"><input type="checkbox" checked={settings.autoClassifyReplies} onChange={(event) => setSettings({ ...settings, autoClassifyReplies: event.target.checked })}/><span>AI phân loại phản hồi</span></label>
        <button className="secondary-button" disabled={busy} onClick={() => void saveSettings()}>Lưu vận hành</button>
      </div>}
      <div className="automation-last-run">Lần chạy gần nhất: <strong>{displayTime(analytics?.lastRunAt || "")}</strong> · {analytics?.lastRunStatus || "Chưa chạy"}</div>

      <div className="campaign-list">
        {!data?.campaigns.length ? <div className="automation-empty"><strong>Chưa có chiến dịch</strong><span>Tạo một chiến dịch, kiểm tra nội dung rồi mới kích hoạt lịch gửi.</span></div> : data.campaigns.map((campaign, index) => {
          const replyRate = campaign.sentRecipients ? campaign.repliedRecipients / campaign.sentRecipients : 0;
          return <article key={campaign.id} className={`campaign-card status-${campaign.status.toLowerCase()}`}>
            <div className="campaign-index">{String(index + 1).padStart(2, "0")}</div>
            <div className="campaign-main"><div><span className={`campaign-status ${campaign.status.toLowerCase()}`}>{campaignStatus(campaign.status)}</span><strong>{campaign.name}</strong></div><p>{campaign.objective}</p><small>Bắt đầu {displayDate(campaign.startDate)} · {campaign.followUpEnabled ? `2 email, Follow-up sau ${campaign.followUpDelayDays} ngày` : "1 email"}</small></div>
            <div className="campaign-stats"><span><b>{campaign.totalRecipients}</b> Lead</span><span><b>{campaign.sentRecipients}</b> đã gửi</span><span><b>{campaign.repliedRecipients}</b> phản hồi</span><span><b>{(replyRate * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%</b> tỷ lệ</span></div>
            <div className="campaign-actions">
              {campaign.status !== "Active" && campaign.status !== "Completed" && <button className="primary-button" disabled={busy} onClick={() => void changeCampaignStatus(campaign, "Active")}>Kích hoạt</button>}
              {campaign.status === "Active" && <button className="secondary-button" disabled={busy} onClick={() => void changeCampaignStatus(campaign, "Paused")}>Tạm dừng</button>}
              {campaign.status !== "Active" && <button className="campaign-delete" disabled={busy} onClick={() => void removeCampaign(campaign)} aria-label={`Xóa ${campaign.name}`}>×</button>}
            </div>
          </article>;
        })}
      </div>
    </section>

    {campaignOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCampaignOpen(false); }}>
      <div className="modal campaign-modal" role="dialog" aria-modal="true" aria-label="Tạo chiến dịch email tự động">
        <header className="modal-header"><div><span>CHIẾN DỊCH CÓ KIỂM SOÁT</span><h2>Tạo chiến dịch email</h2><p>Lưu dưới dạng bản nháp; chưa gửi cho đến khi anh kích hoạt.</p></div><button className="modal-close" onClick={() => setCampaignOpen(false)} aria-label="Đóng">×</button></header>
        <form onSubmit={saveCampaignForm}><div className="modal-body campaign-form-grid">
          <section className="campaign-form-main">
            <div className="campaign-ai-box"><div><strong>AI soạn khung chiến dịch</strong><small>Mô tả mục tiêu và nhóm khách hàng; anh vẫn kiểm tra, chỉnh sửa trước khi lưu.</small></div><button type="button" className="ai-button" disabled={aiBusy} onClick={() => void draftWithAi()}>{aiBusy ? "AI đang soạn..." : "✦ Soạn bằng AI"}</button></div>
            <div className="form-grid">
              <label className="form-field"><span>Tên chiến dịch <b>*</b></span><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
              <label className="form-field"><span>Ngày bắt đầu</span><input type="date" min={today()} value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}/></label>
              <label className="form-field field-wide"><span>Mục tiêu chiến dịch <b>*</b></span><textarea rows={3} required value={draft.objective} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} placeholder="Ví dụ: giới thiệu camera nhiệt Fluke cho bộ phận bảo trì nhà máy..."/></label>
              <label className="form-field field-wide"><span>Ngành/nhóm khách hàng</span><input value={draft.industry} onChange={(event) => setDraft({ ...draft, industry: event.target.value })}/></label>
            </div>
            <div className="campaign-step"><header><span>EMAIL 1</span><strong>Tiếp cận ban đầu</strong></header><label className="form-field"><span>Tiêu đề</span><input required value={draft.subjectTemplate} onChange={(event) => setDraft({ ...draft, subjectTemplate: event.target.value })}/></label><label className="form-field"><span>Nội dung</span><textarea rows={10} required value={draft.bodyTemplate} onChange={(event) => setDraft({ ...draft, bodyTemplate: event.target.value })}/></label></div>
            <div className="campaign-step followup"><header><label><input type="checkbox" checked={draft.followUpEnabled} onChange={(event) => setDraft({ ...draft, followUpEnabled: event.target.checked })}/><span>EMAIL 2</span><strong>Follow-up tự động nếu chưa phản hồi</strong></label><div><span>Sau</span><input type="number" min={1} max={30} value={draft.followUpDelayDays} onChange={(event) => setDraft({ ...draft, followUpDelayDays: Number(event.target.value) })}/><span>ngày</span></div></header>{draft.followUpEnabled && <><label className="form-field"><span>Tiêu đề Follow-up</span><input required value={draft.followUpSubjectTemplate} onChange={(event) => setDraft({ ...draft, followUpSubjectTemplate: event.target.value })}/></label><label className="form-field"><span>Nội dung Follow-up</span><textarea rows={8} required value={draft.followUpBodyTemplate} onChange={(event) => setDraft({ ...draft, followUpBodyTemplate: event.target.value })}/></label></>}</div>
            <p className="email-token-help">Có thể dùng: {"{{companyName}}"}, {"{{contactName}}"}, {"{{salutation}}"}, {"{{title}}"}, {"{{industry}}"}</p>
          </section>

          <aside className="campaign-form-side">
            <section className="campaign-recipient-select"><header><div><strong>Lead nhận email</strong><small>Không hiển thị Lead đã từ chối email · tối đa 300 Lead</small></div><span>{draft.leadIds.length} đã chọn</span></header><input value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Tìm công ty, email, ngành..."/><button type="button" onClick={() => setDraft({ ...draft, leadIds: eligibleLeads.slice(0, 300).map((lead) => lead.id) })}>Chọn tất cả đang hiển thị</button><div>{eligibleLeads.map((lead) => <label key={lead.id} className={draft.leadIds.includes(lead.id) ? "is-selected" : ""}><input aria-label={`Chọn Lead ${lead.companyName}`} type="checkbox" checked={draft.leadIds.includes(lead.id)} onChange={() => toggleLead(lead.id)}/><span><strong>{lead.companyName}</strong><small>{lead.contactName || lead.industry || "Chưa có người liên hệ"} · {lead.email}</small></span></label>)}</div></section>
            <section className="campaign-asset-select"><header><strong>Ảnh & tệp gửi kèm</strong><span>{draft.assetIds.length}/5</span></header>{!assets.length ? <p>Kho tệp đang trống.</p> : assets.map((asset) => <label key={asset.id} className={draft.assetIds.includes(asset.id) ? "is-selected" : ""}><input aria-label={`Chọn tệp ${asset.fileName}`} type="checkbox" checked={draft.assetIds.includes(asset.id)} onChange={() => toggleAsset(asset.id)}/><span><strong>{asset.fileName}</strong><small>{asset.fileKind === "image" ? "Chèn trong email" : "Tệp đính kèm"}</small></span></label>)}</section>
            <aside className="campaign-safety"><strong>Quy tắc bảo vệ</strong><span>✓ Giới hạn email/ngày</span><span>✓ Gửi theo lô nhỏ</span><span>✓ Tự dừng khi có phản hồi</span><span>✓ Không gửi Lead đã opt-out</span><span>✓ AI không tự gửi bản nháp trả lời</span></aside>
          </aside>
          {formError && <div className="email-feedback error campaign-form-error">{formError}</div>}
        </div><footer className="modal-footer"><span>Sau khi lưu, chiến dịch ở trạng thái Bản nháp.</span><div><button type="button" className="secondary-button" onClick={() => setCampaignOpen(false)}>Hủy</button><button className="primary-button" disabled={busy || aiBusy}>{busy ? "Đang lưu..." : "Lưu bản nháp"}</button></div></footer></form>
      </div>
    </div>}
  </>;
}
