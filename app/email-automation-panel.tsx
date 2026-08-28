"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  EmailAsset,
  EmailAutomationAnalytics,
  EmailAutomationSettings,
  EmailCampaign,
  EmailLeadSendStat,
  Lead,
} from "@/lib/crm";
import {
  INDUSTRY_EMAIL_TEMPLATES,
  industryTemplateById,
  industryTemplateForLead,
  type EmailIndustryTemplate,
  type EmailSequenceStep,
} from "@/lib/industry-email-templates";

type AutomationPayload = {
  automation: EmailAutomationSettings;
  campaigns: EmailCampaign[];
  analytics: EmailAutomationAnalytics;
  templates: EmailIndustryTemplate[];
  result?: Record<string, unknown>;
  error?: string;
};

type CampaignDraft = {
  name: string;
  objective: string;
  industry: string;
  industryTemplateId: string;
  industryGroup: string;
  startDate: string;
  sequenceSteps: EmailSequenceStep[];
  leadIds: string[];
  assetIds: string[];
};

type RunButtonState = {
  tone: "sent" | "idle" | "failed";
  label: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyCampaign = (): CampaignDraft => ({
  name: "",
  objective: "",
  industry: "",
  industryTemplateId: "",
  industryGroup: "",
  startDate: today(),
  sequenceSteps: [{
    order: 1,
    label: "Tiếp cận ban đầu",
    delayDays: 0,
    subjectTemplate: "Giải pháp thiết bị đo Fluke cho {{companyName}}",
    bodyTemplate: "",
  }],
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
  leadSendStats,
  emailConfigured,
  onChanged,
}: {
  leads: Lead[];
  assets: EmailAsset[];
  leadSendStats: EmailLeadSendStat[];
  emailConfigured: boolean;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<AutomationPayload | null>(null);
  const [settings, setSettings] = useState<EmailAutomationSettings | null>(null);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaign());
  const [leadSearch, setLeadSearch] = useState("");
  const [leadIndustryGroup, setLeadIndustryGroup] = useState("");
  const [leadIndustry, setLeadIndustry] = useState("");
  const [leadHistory, setLeadHistory] = useState<"all" | "never" | "sent">("all");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const [formError, setFormError] = useState("");
  const [runButtonState, setRunButtonState] = useState<RunButtonState | null>(null);

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
    setRunButtonState(null);
    try {
      const next = await automationRequest({ action: "runNow" });
      updatePayload(next);
      const sent = Number(next.result?.sent || 0);
      const failed = Number(next.result?.failed || 0);
      const replies = Number(next.result?.repliesAdded || 0);
      const skipped = typeof next.result?.skipped === "string" ? next.result.skipped : "";
      if (sent > 0) {
        setRunButtonState({ tone: "sent", label: `✓ Đã gửi ${sent} email` });
        showFeedback(`Đã gửi ${sent} email${failed ? `; ${failed} email lỗi` : ""} và ghi nhận ${replies} phản hồi mới.`, failed > 0);
      } else if (failed > 0) {
        setRunButtonState({ tone: "failed", label: `⚠ ${failed} email gửi lỗi` });
        showFeedback(`${failed} email gửi thất bại. Hãy kiểm tra nhật ký gửi bên dưới.`, true);
      } else {
        setRunButtonState({ tone: "idle", label: "Không có email được gửi" });
        showFeedback(`Không có email được gửi. ${skipped || "Chưa có Lead đến hạn."}`, true);
      }
      await onChanged();
    } catch (error) {
      setRunButtonState({ tone: "failed", label: "Chạy lịch thất bại" });
      showFeedback(error instanceof Error ? error.message : "Không thể chạy lịch email.", true);
    } finally {
      setBusy(false);
    }
  };

  const sendStatsByLead = useMemo(() => new Map(
    leadSendStats.map((item) => [item.leadId, item]),
  ), [leadSendStats]);

  const leadIndustries = useMemo(() => [...new Set(leads
    .filter((lead) => lead.email && !lead.emailOptOut && lead.status !== "Không nhận email" && lead.status !== "Đã chuyển cơ hội")
    .map((lead) => lead.industry.trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")), [leads]);

  const eligibleLeads = useMemo(() => leads.filter((lead) => {
    if (!lead.email || lead.emailOptOut || lead.status === "Không nhận email" || lead.status === "Đã chuyển cơ hội") return false;
    const query = normalize(leadSearch.trim());
    const sentCount = Number(sendStatsByLead.get(lead.id)?.sentCount || 0);
    if (leadIndustryGroup && industryTemplateForLead(lead.industry)?.id !== leadIndustryGroup) return false;
    if (leadIndustry && lead.industry !== leadIndustry) return false;
    if (leadHistory === "never" && sentCount > 0) return false;
    if (leadHistory === "sent" && sentCount === 0) return false;
    return !query || normalize(`${lead.companyName} ${lead.contactName} ${lead.email} ${lead.industry}`).includes(query);
  }).sort((a, b) => {
    const aStat = sendStatsByLead.get(a.id);
    const bStat = sendStatsByLead.get(b.id);
    const aSent = Number(aStat?.sentCount || 0);
    const bSent = Number(bStat?.sentCount || 0);
    if ((aSent === 0) !== (bSent === 0)) return aSent === 0 ? -1 : 1;
    if ((aStat?.lastSentAt || "") !== (bStat?.lastSentAt || "")) {
      return (aStat?.lastSentAt || "").localeCompare(bStat?.lastSentAt || "");
    }
    return a.companyName.localeCompare(b.companyName, "vi");
  }), [leadHistory, leadIndustry, leadIndustryGroup, leadSearch, leads, sendStatsByLead]);

  const templates = data?.templates?.length ? data.templates : INDUSTRY_EMAIL_TEMPLATES;

  const matchingLeadIds = ({
    groupId,
    industry = "",
    history = "never",
    search = "",
  }: {
    groupId: string;
    industry?: string;
    history?: "all" | "never" | "sent";
    search?: string;
  }) => {
    const query = normalize(search.trim());
    const uniqueEmails = new Set<string>();
    return leads.filter((lead) => {
      const email = lead.email.trim().toLowerCase();
      const sentCount = Number(sendStatsByLead.get(lead.id)?.sentCount || 0);
      if (!email || uniqueEmails.has(email) || lead.emailOptOut || lead.status === "Không nhận email" || lead.status === "Đã chuyển cơ hội") return false;
      if (groupId && industryTemplateForLead(lead.industry)?.id !== groupId) return false;
      if (industry && lead.industry !== industry) return false;
      if (history === "never" && sentCount > 0) return false;
      if (history === "sent" && sentCount === 0) return false;
      if (query && !normalize(`${lead.companyName} ${lead.contactName} ${lead.email} ${lead.industry}`).includes(query)) return false;
      uniqueEmails.add(email);
      return true;
    }).slice(0, 300).map((lead) => lead.id);
  };

  const matchingLeadCount = (templateId: string) => matchingLeadIds({ groupId: templateId }).length;

  const applyIndustryTemplate = (template: EmailIndustryTemplate) => {
    const leadIds = matchingLeadIds({ groupId: template.id });
    setDraft({
      ...emptyCampaign(),
      name: `Chiến dịch Fluke – ${template.groupName}`,
      objective: template.description,
      industry: template.groupName,
      industryTemplateId: template.id,
      industryGroup: template.groupName,
      sequenceSteps: template.steps.map((step) => ({ ...step })),
      leadIds,
    });
    setLeadSearch("");
    setLeadIndustryGroup(template.id);
    setLeadIndustry("");
    setLeadHistory("never");
    setFormError(leadIds.length ? "" : "Chưa có Lead mới thuộc nhóm này có địa chỉ email hợp lệ.");
  };

  const openCampaign = () => {
    setDraft(emptyCampaign());
    setLeadSearch("");
    setLeadIndustryGroup("");
    setLeadIndustry("");
    setLeadHistory("all");
    setFormError("");
    setCampaignOpen(true);
  };

  const openTemplateCampaign = (template: EmailIndustryTemplate) => {
    applyIndustryTemplate(template);
    setCampaignOpen(true);
  };

  const chooseIndustryTemplate = (id: string) => {
    const template = industryTemplateById(id);
    if (template) applyIndustryTemplate(template);
  };

  const chooseDetailedIndustry = (industry: string) => {
    setLeadIndustry(industry);
    if (!leadIndustryGroup && !industry) return;
    const leadIds = matchingLeadIds({
      groupId: leadIndustryGroup,
      industry,
      history: leadHistory,
      search: leadSearch,
    });
    setDraft((current) => ({ ...current, leadIds }));
    setFormError(leadIds.length ? "" : "Ngành này chưa có địa chỉ email phù hợp với điều kiện đang lọc.");
  };

  const chooseLeadHistory = (history: "all" | "never" | "sent") => {
    setLeadHistory(history);
    if (!leadIndustryGroup && !leadIndustry) return;
    const leadIds = matchingLeadIds({
      groupId: leadIndustryGroup,
      industry: leadIndustry,
      history,
      search: leadSearch,
    });
    setDraft((current) => ({ ...current, leadIds }));
    setFormError(leadIds.length ? "" : "Không có địa chỉ email phù hợp với ngành và lịch sử gửi đã chọn.");
  };

  const updateSequenceStep = (index: number, values: Partial<EmailSequenceStep>) => {
    setDraft((current) => ({
      ...current,
      sequenceSteps: current.sequenceSteps.map((step, stepIndex) => stepIndex === index ? { ...step, ...values } : step),
    }));
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
        sequenceSteps: current.sequenceSteps.map((step, index) => index === 0 ? {
          ...step,
          subjectTemplate: String(next.result?.subject || step.subjectTemplate),
          bodyTemplate: String(next.result?.body || step.bodyTemplate),
        } : index === 1 ? {
          ...step,
          subjectTemplate: String(next.result?.followUpSubject || step.subjectTemplate),
          bodyTemplate: String(next.result?.followUpBody || step.bodyTemplate),
        } : step),
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
      setRunButtonState(null);
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
  const runBlockedLabel = !data?.automation.enabled
    ? "Bật tự động hóa trước"
    : !analytics?.activeCampaigns
      ? "Kích hoạt chiến dịch trước"
      : "";
  const runButtonLabel = busy ? "Đang xử lý..." : runBlockedLabel || runButtonState?.label || "Chạy lịch ngay";
  const lastRunSummary = !analytics?.lastRunAt
    ? "Chưa chạy"
    : analytics.lastRunStatus === "Failed"
      ? `Thất bại${analytics.lastRunMessage ? ` · ${analytics.lastRunMessage}` : ""}`
      : analytics.lastRunSent > 0
        ? `Đã gửi ${analytics.lastRunSent} email${analytics.lastRunFailed ? ` · ${analytics.lastRunFailed} lỗi` : ""}`
        : analytics.lastRunMessage
          ? `Không gửi · ${analytics.lastRunMessage}`
          : !analytics.activeCampaigns
            ? "Không gửi · chưa có chiến dịch đang chạy"
            : "Đã kiểm tra lịch · chưa có email đến hạn";
  const campaigns = data?.campaigns || [];
  const activeCampaignCount = campaigns.filter((campaign) => campaign.status === "Active").length;
  const draftCampaignCount = campaigns.filter((campaign) => campaign.status === "Draft").length;
  const pausedCampaignCount = campaigns.filter((campaign) => campaign.status === "Paused").length;
  const orderedCampaigns = [...campaigns].sort((left, right) => {
    const rank = { Draft: 0, Paused: 1, Active: 2, Completed: 3 } as const;
    return rank[left.status] - rank[right.status] || right.updatedAt.localeCompare(left.updatedAt);
  });
  const campaignGuidance = !data?.automation.enabled
    ? "Bật tự động hóa và lưu vận hành trước khi kích hoạt chiến dịch."
    : draftCampaignCount > 0
      ? `Có ${draftCampaignCount} chiến dịch Bản nháp cần kiểm tra và kích hoạt.`
      : pausedCampaignCount > 0
        ? `Có ${pausedCampaignCount} chiến dịch đang tạm dừng; kích hoạt lại khi sẵn sàng.`
        : activeCampaignCount > 0
          ? `${activeCampaignCount} chiến dịch đang chạy; hệ thống sẽ gửi theo lịch đã cài đặt.`
          : "Chưa có chiến dịch hoạt động. Tạo mới từ kho mẫu email bên dưới.";

  return <>
    <section className={`automation-center panel ${data?.automation.enabled ? "is-enabled" : ""}`}>
      <header className="automation-header">
        <div><span>GIAI ĐOẠN 4 · AI & TỰ ĐỘNG HÓA</span><strong>Trung tâm chiến dịch email</strong><small>Mặc định an toàn: giới hạn theo ngày, gửi theo lô và dừng ngay khi khách phản hồi.</small></div>
        <div className="automation-header-actions">
          <span className={`automation-master-state ${data?.automation.enabled ? "on" : "off"}`}>{data?.automation.enabled ? "ĐANG BẬT" : "ĐANG TẮT"}</span>
          <button className="secondary-button" disabled={!data || busy} onClick={openCampaign}>＋ Tạo chiến dịch</button>
          <button className={`primary-button run-now-button ${runButtonState ? `is-${runButtonState.tone}` : ""}`} disabled={Boolean(runBlockedLabel) || busy} onClick={() => void runNow()}>{runButtonLabel}</button>
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
        <label><span>Mục tiêu/ngày</span><input type="number" min={20} max={50} value={settings.dailyLimit} onChange={(event) => setSettings({ ...settings, dailyLimit: Number(event.target.value) })}/><small>Điều chỉnh từ 20–50 email</small></label>
        <label><span>Mỗi lượt</span><input type="number" min={1} max={5} value={settings.batchSize} onChange={(event) => setSettings({ ...settings, batchSize: Number(event.target.value) })}/></label>
        <label><span>Từ giờ</span><input type="number" min={0} max={22} value={settings.sendStartHour} onChange={(event) => setSettings({ ...settings, sendStartHour: Number(event.target.value) })}/></label>
        <label><span>Đến giờ</span><input type="number" min={1} max={23} value={settings.sendEndHour} onChange={(event) => setSettings({ ...settings, sendEndHour: Number(event.target.value) })}/></label>
        <label className="automation-check"><input type="checkbox" checked={settings.weekdaysOnly} onChange={(event) => setSettings({ ...settings, weekdaysOnly: event.target.checked })}/><span>Chỉ Thứ 2–Thứ 6</span></label>
        <label className="automation-check"><input type="checkbox" checked={settings.autoClassifyReplies} onChange={(event) => setSettings({ ...settings, autoClassifyReplies: event.target.checked })}/><span>AI phân loại phản hồi</span></label>
        <button className="secondary-button" disabled={busy} onClick={() => void saveSettings()}>Lưu vận hành</button>
      </div>}
      <div className={`automation-last-run ${analytics?.lastRunSent ? "is-sent" : ""}`}>Lần chạy gần nhất: <strong>{displayTime(analytics?.lastRunAt || "")}</strong> · {lastRunSummary}</div>

      <section className="campaign-command-center" aria-label="Quản lý và kích hoạt chiến dịch">
        <header className="campaign-command-header">
          <div><span>CHIẾN DỊCH CỦA ANH</span><strong>Quản lý & kích hoạt</strong><small>Chiến dịch cần xử lý luôn nằm tại đây, không phải cuộn qua kho mẫu.</small></div>
          <div className="campaign-command-summary">
            <span className="is-active"><b>{activeCampaignCount}</b> đang chạy</span>
            <span className={draftCampaignCount ? "needs-action" : ""}><b>{draftCampaignCount}</b> bản nháp</span>
            <button className="secondary-button" disabled={!data || busy} onClick={openCampaign}>＋ Tạo mới</button>
          </div>
        </header>
        <div className={`campaign-guidance ${draftCampaignCount || pausedCampaignCount || !data?.automation.enabled ? "needs-action" : "is-ready"}`}>
          <span>{draftCampaignCount || pausedCampaignCount || !data?.automation.enabled ? "BƯỚC TIẾP THEO" : "TRẠNG THÁI"}</span>
          <strong>{campaignGuidance}</strong>
        </div>
        <div className="campaign-list">
          {!orderedCampaigns.length ? <div className="automation-empty"><strong>Chưa có chiến dịch</strong><span>Chọn “Tạo mới” hoặc dùng một bộ mẫu ngành ở bên dưới.</span></div> : orderedCampaigns.map((campaign, index) => {
            const replyRate = campaign.sentRecipients ? campaign.repliedRecipients / campaign.sentRecipients : 0;
            const stateNote = campaign.status === "Draft" ? "Chưa gửi · cần kích hoạt"
              : campaign.status === "Paused" ? "Đang tạm dừng"
                : campaign.status === "Active" ? "Đang vận hành theo lịch" : "Đã hoàn thành chuỗi email";
            return <article key={campaign.id} className={`campaign-card status-${campaign.status.toLowerCase()}`}>
              <div className="campaign-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="campaign-main"><div><span className={`campaign-status ${campaign.status.toLowerCase()}`}>{campaignStatus(campaign.status)}</span><strong>{campaign.name}</strong></div><p>{campaign.objective}</p><small>{stateNote} · Bắt đầu {displayDate(campaign.startDate)} · {campaign.industryGroup ? `${campaign.industryGroup} · ` : ""}{campaign.sequenceSteps.length || (campaign.followUpEnabled ? 2 : 1)} email</small></div>
              <div className="campaign-stats"><span><b>{campaign.totalRecipients}</b> Lead</span><span><b>{campaign.sentRecipients}</b> đã gửi</span><span><b>{campaign.repliedRecipients}</b> phản hồi</span><span><b>{(replyRate * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%</b> tỷ lệ</span></div>
              <div className="campaign-actions">
                {campaign.status !== "Active" && campaign.status !== "Completed" && <button className="primary-button campaign-activate" disabled={busy} onClick={() => void changeCampaignStatus(campaign, "Active")}>Kích hoạt chiến dịch</button>}
                {campaign.status === "Active" && <button className="secondary-button" disabled={busy} onClick={() => void changeCampaignStatus(campaign, "Paused")}>Tạm dừng</button>}
                {campaign.status !== "Active" && <button className="campaign-delete" disabled={busy} onClick={() => void removeCampaign(campaign)} aria-label={`Xóa ${campaign.name}`}>×</button>}
              </div>
            </article>;
          })}
        </div>
      </section>

      <section className="email-template-library">
        <header className="template-library-header">
          <div><span>KHO MAIL THEO NHÓM NGÀNH</span><strong>6 bộ mẫu · 24 email cá nhân hóa</strong><small>Chọn một nhóm để nạp 4 email và tự chọn các Lead mới có email thuộc đúng ngành.</small></div>
          <em>Nháp trước · Kích hoạt sau</em>
        </header>
        <div className="template-library-grid">{templates.map((template) => {
          const count = matchingLeadCount(template.id);
          return <article key={template.id} className="industry-template-card">
            <div className="template-card-top"><span>{String(template.steps.length).padStart(2, "0")} EMAIL</span><b>{count} Lead mới</b></div>
            <strong>{template.groupName}</strong>
            <p>{template.description}</p>
            <div className="template-step-count"><span>Ngày 0</span><i>→</i><span>+3</span><i>→</i><span>+5</span><i>→</i><span>+7</span></div>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => openTemplateCampaign(template)}>Dùng bộ mẫu</button>
          </article>;
        })}</div>
      </section>

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
              <label className="form-field field-wide"><span>Bộ mẫu email theo nhóm ngành <b>*</b></span><select required value={draft.industryTemplateId} onChange={(event) => chooseIndustryTemplate(event.target.value)}><option value="">Chọn một trong 6 nhóm ngành</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.groupName} · 4 email</option>)}</select><small>Khi chọn nhóm, hệ thống tự nạp nội dung và chọn các Lead mới phù hợp.</small></label>
              <label className="form-field field-wide"><span>Mục tiêu chiến dịch <b>*</b></span><textarea rows={3} required value={draft.objective} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} placeholder="Ví dụ: giới thiệu camera nhiệt Fluke cho bộ phận bảo trì nhà máy..."/></label>
              <label className="form-field field-wide"><span>Ngành/nhóm khách hàng</span><input readOnly value={draft.industry} placeholder="Được điền từ bộ mẫu đã chọn"/></label>
            </div>
            {draft.sequenceSteps.map((step, index) => <div key={step.order} className={`campaign-step ${index ? "followup" : ""}`}>
              <header><div className="campaign-step-name"><span>EMAIL {step.order}</span><strong>{step.label}</strong></div>{index > 0 && <div><span>Gửi sau email trước</span><input aria-label={`Số ngày chờ Email ${step.order}`} type="number" min={1} max={30} value={step.delayDays} onChange={(event) => updateSequenceStep(index, { delayDays: Number(event.target.value) })}/><span>ngày</span></div>}</header>
              <label className="form-field"><span>Tiêu đề</span><input required value={step.subjectTemplate} onChange={(event) => updateSequenceStep(index, { subjectTemplate: event.target.value })}/></label>
              <label className="form-field"><span>Nội dung</span><textarea rows={index ? 8 : 10} required value={step.bodyTemplate} onChange={(event) => updateSequenceStep(index, { bodyTemplate: event.target.value })}/></label>
            </div>)}
            <p className="email-token-help">Có thể dùng: {"{{companyName}}"}, {"{{plantSite}}"}, {"{{targetDepartment}}"}, {"{{recommendedSolution}}"}, {"{{contactName}}"}, {"{{title}}"}, {"{{industry}}"}</p>
          </section>

          <aside className="campaign-form-side">
            <section className="campaign-recipient-select">
              <header><div><strong>Email/Lead nhận chiến dịch</strong><small>Tự chọn theo ngành · loại email trùng · tối đa 300 địa chỉ</small></div><span>{draft.leadIds.length} đã chọn</span></header>
              <div className="campaign-recipient-filters">
                <input aria-label="Tìm Lead trong chiến dịch" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Tìm công ty, email, ngành..."/>
                <select aria-label="Lọc Lead theo bộ mẫu ngành" value={leadIndustryGroup} onChange={(event) => chooseIndustryTemplate(event.target.value)}><option value="">Tất cả 6 nhóm ngành</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.groupName}</option>)}</select>
                <select aria-label="Lọc ngành chi tiết cho chiến dịch" value={leadIndustry} onChange={(event) => chooseDetailedIndustry(event.target.value)}><option value="">Tất cả ngành chi tiết</option>{leadIndustries.map((industry) => <option key={industry} value={industry}>{industry}</option>)}</select>
                <select aria-label="Lọc lịch sử gửi cho chiến dịch" value={leadHistory} onChange={(event) => chooseLeadHistory(event.target.value as "all" | "never" | "sent")}><option value="all">Tất cả lịch sử</option><option value="never">Chưa gửi lần nào</option><option value="sent">Đã từng gửi</option></select>
              </div>
              {draft.industryTemplateId && <div className={`recipient-auto-selected ${draft.leadIds.length ? "success" : "empty"}`}><strong>{draft.leadIds.length ? `✓ Đã tự chọn ${draft.leadIds.length} địa chỉ email` : "Chưa có email phù hợp"}</strong><span>{draft.leadIds.length ? `Đúng nhóm ${draft.industryGroup}; anh vẫn có thể bỏ tích từng công ty.` : "Lead thiếu email, đã gửi, opt-out hoặc đã vào cơ hội sẽ không được chọn."}</span></div>}
              <div className="campaign-recipient-toolbar"><span>{eligibleLeads.length} công ty phù hợp</span><div><button type="button" onClick={() => setDraft({ ...draft, leadIds: matchingLeadIds({ groupId: leadIndustryGroup, industry: leadIndustry, history: leadHistory, search: leadSearch }) })}>Chọn nhóm đang hiển thị</button><button type="button" onClick={() => setDraft({ ...draft, leadIds: [] })} disabled={!draft.leadIds.length}>Bỏ chọn</button></div></div>
              <div className="campaign-recipient-list">{eligibleLeads.map((lead) => {
                const stat = sendStatsByLead.get(lead.id);
                const sentCount = Number(stat?.sentCount || 0);
                return <label key={lead.id} className={draft.leadIds.includes(lead.id) ? "is-selected" : ""}>
                  <input aria-label={`Chọn Lead ${lead.companyName}`} type="checkbox" checked={draft.leadIds.includes(lead.id)} onChange={() => toggleLead(lead.id)}/>
                  <span><strong>{lead.companyName}</strong><small>{lead.industry || "Chưa phân nhóm"} · {lead.email}</small></span>
                  <span className={`email-recipient-history ${sentCount ? "has-sent" : "not-sent"}`}><strong>{sentCount ? `Đã gửi ${sentCount} lần` : "Chưa gửi"}</strong><small>{sentCount ? `Gần nhất ${displayTime(stat?.lastSentAt || "")}` : "Sẵn sàng tiếp cận"}</small></span>
                </label>;
              })}</div>
            </section>
            <section className="campaign-asset-select"><header><strong>Ảnh & tệp gửi kèm</strong><span>{draft.assetIds.length}/5</span></header>{!assets.length ? <p>Kho tệp đang trống.</p> : assets.map((asset) => <label key={asset.id} className={draft.assetIds.includes(asset.id) ? "is-selected" : ""}><input aria-label={`Chọn tệp ${asset.fileName}`} type="checkbox" checked={draft.assetIds.includes(asset.id)} onChange={() => toggleAsset(asset.id)}/><span><strong>{asset.fileName}</strong><small>{asset.fileKind === "image" ? "Chèn trong email" : "Tệp đính kèm"}</small></span></label>)}</section>
            <aside className="campaign-safety"><strong>Quy tắc bảo vệ</strong><span>✓ Giới hạn email/ngày</span><span>✓ Gửi theo lô nhỏ</span><span>✓ Tự dừng khi có phản hồi</span><span>✓ Không gửi Lead đã opt-out</span><span>✓ AI không tự gửi bản nháp trả lời</span></aside>
          </aside>
          {formError && <div className="email-feedback error campaign-form-error">{formError}</div>}
        </div><footer className="modal-footer"><span>Sau khi lưu, chiến dịch ở trạng thái Bản nháp.</span><div><button type="button" className="secondary-button" onClick={() => setCampaignOpen(false)}>Hủy</button><button className="primary-button" disabled={busy || aiBusy}>{busy ? "Đang lưu..." : "Lưu bản nháp"}</button></div></footer></form>
      </div>
    </div>}
  </>;
}
