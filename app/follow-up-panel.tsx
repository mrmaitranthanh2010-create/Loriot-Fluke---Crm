"use client";

import { useMemo, useState } from "react";
import type { Activity } from "@/lib/crm";

export type ActivityDraft = Omit<Activity, "createdAt" | "updatedAt">;

const today = () => new Date().toISOString().slice(0, 10);
const emptyActivity = (opportunityId: string, contactName: string, owner: string): ActivityDraft => ({
  id: "",
  opportunityId,
  activityDate: today(),
  activityType: "Email",
  contactName,
  summary: "",
  outcome: "",
  nextStep: "",
  dueDate: "",
  owner: owner || "Mai Trần Thành",
  status: "Completed",
  includeInWeeklyReport: false,
});

const shortDate = (value: string) => value
  ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`))
  : "—";

export function FollowUpPanel({ opportunityId, contactName, owner, activities, saving, onSave, onDelete }: {
  opportunityId: string;
  contactName: string;
  owner: string;
  activities: Activity[];
  saving: boolean;
  onSave: (activity: ActivityDraft) => Promise<boolean>;
  onDelete: (activity: Activity) => Promise<void>;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<ActivityDraft>(() => emptyActivity(opportunityId, contactName, owner));
  const rows = useMemo(() => activities
    .filter((activity) => activity.opportunityId === opportunityId)
    .sort((a, b) => b.activityDate.localeCompare(a.activityDate) || b.createdAt.localeCompare(a.createdAt)), [activities, opportunityId]);
  const update = <K extends keyof ActivityDraft>(key: K, value: ActivityDraft[K]) => setDraft({ ...draft, [key]: value });
  const hasContent = Boolean(draft.summary.trim() || draft.outcome.trim() || draft.nextStep.trim());
  const add = () => { setDraft(emptyActivity(opportunityId, contactName, owner)); setEditorOpen(true); };
  const edit = (activity: Activity) => {
    setDraft({
      id: activity.id,
      opportunityId: activity.opportunityId,
      activityDate: activity.activityDate,
      activityType: activity.activityType,
      contactName: activity.contactName,
      summary: activity.summary,
      outcome: activity.outcome,
      nextStep: activity.nextStep,
      dueDate: activity.dueDate,
      owner: activity.owner,
      status: activity.status,
      includeInWeeklyReport: activity.includeInWeeklyReport,
    });
    setEditorOpen(true);
  };
  const save = async () => {
    if (!hasContent) return;
    if (await onSave(draft)) {
      setDraft(emptyActivity(opportunityId, contactName, owner));
      setEditorOpen(false);
    }
  };
  const toggleReport = async (activity: Activity) => {
    await onSave({
      id: activity.id,
      opportunityId: activity.opportunityId,
      activityDate: activity.activityDate,
      activityType: activity.activityType,
      contactName: activity.contactName,
      summary: activity.summary,
      outcome: activity.outcome,
      nextStep: activity.nextStep,
      dueDate: activity.dueDate,
      owner: activity.owner,
      status: activity.status,
      includeInWeeklyReport: !activity.includeInWeeklyReport,
    });
  };

  if (!opportunityId) return <section className="form-section follow-up-section"><div className="section-title"><div>↻</div><span><strong>Nhật ký Follow-up & Next Step</strong><small>Lưu cơ hội trước để bắt đầu ghi lịch sử chăm sóc</small></span></div><div className="follow-up-empty"><strong>Chưa thể thêm Follow-up</strong><span>Sau khi tạo cơ hội, mở lại hồ sơ này để thêm từng lần Email, Phone, Zalo hoặc Meeting.</span></div></section>;

  return <section className="form-section follow-up-section"><div className="section-title"><div>↻</div><span><strong>Nhật ký Follow-up & Next Step</strong><small>Mỗi lần chăm sóc là một dòng; chỉ dòng được tích mới sang báo cáo tuần</small></span><button type="button" className="secondary-button follow-up-add" onClick={add}>＋ Thêm dòng</button></div>
    {editorOpen && <div className="follow-up-editor">
      <div className="follow-up-editor-grid">
        <label><span>Ngày</span><input type="date" value={draft.activityDate} onChange={(event) => update("activityDate", event.target.value)}/></label>
        <label><span>Kênh</span><select value={draft.activityType} onChange={(event) => update("activityType", event.target.value)}><option>Email</option><option>Phone</option><option>Zalo</option><option>Meeting</option><option>Khác</option></select></label>
        <label><span>Người liên hệ</span><input value={draft.contactName} onChange={(event) => update("contactName", event.target.value)}/></label>
        <label><span>Trạng thái</span><select value={draft.status} onChange={(event) => update("status", event.target.value as ActivityDraft["status"])}><option value="Completed">Đã thực hiện</option><option value="Pending">Đang chờ</option><option value="Cancelled">Đã hủy</option></select></label>
        <label className="follow-up-wide"><span>Thông tin Follow-up <small>Không bắt buộc</small></span><textarea rows={3} value={draft.summary} onChange={(event) => update("summary", event.target.value)} placeholder="Điền khi anh có chủ động trao đổi, gọi điện, gửi email..."/></label>
        <label className="follow-up-wide"><span>Kết quả / phản hồi <small>Có thể chỉ điền mục này</small></span><textarea rows={2} value={draft.outcome} onChange={(event) => update("outcome", event.target.value)} placeholder="Thông tin khách hàng phản hồi hoặc tình trạng mới nhất"/></label>
        <label><span>Next Step mới <small>Không bắt buộc</small></span><input value={draft.nextStep} onChange={(event) => update("nextStep", event.target.value)} placeholder="Chỉ điền khi đã có hành động tiếp theo"/></label>
        <label><span>Hạn Next Step <small>Không bắt buộc</small></span><input type="date" value={draft.dueDate} onChange={(event) => update("dueDate", event.target.value)}/></label>
      </div>
      <p className="follow-up-entry-note">Chỉ cần điền một trong ba mục: Thông tin Follow-up, Kết quả/phản hồi hoặc Next Step.</p>
      <label className="follow-up-report-choice"><input aria-label="Đưa Follow-up vào báo cáo tuần" type="checkbox" checked={draft.includeInWeeklyReport} onChange={(event) => update("includeInWeeklyReport", event.target.checked)}/><span><strong>Đưa vào báo cáo tuần</strong><small>Chỉ chọn các thông tin đủ giá trị để gửi sếp.</small></span></label>
      <div className="follow-up-editor-actions"><button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>Hủy</button><button type="button" className="primary-button" disabled={saving || !hasContent} onClick={() => void save()}>{saving ? "Đang lưu..." : draft.id ? "Lưu thay đổi" : "Lưu cập nhật"}</button></div>
    </div>}
    {rows.length === 0 ? <div className="follow-up-empty"><strong>Chưa có lịch sử chăm sóc</strong><span>Bấm “Thêm dòng” sau mỗi lần Email, gọi điện, Zalo hoặc gặp khách.</span></div> : <div className="follow-up-list"><div className="follow-up-head"><span>Ngày / Kênh</span><span>Thông tin & kết quả</span><span>Next Step</span><span>Báo cáo tuần</span><span /></div>{rows.map((activity) => <article key={activity.id} className={activity.includeInWeeklyReport ? "is-reported" : ""}>
      <div><strong>{shortDate(activity.activityDate)}</strong><span>{activity.activityType} · {activity.status === "Completed" ? "Đã thực hiện" : activity.status === "Pending" ? "Đang chờ" : "Đã hủy"}</span></div>
      <div><strong>{activity.summary || activity.outcome || "Cập nhật khách hàng"}</strong><span>{activity.summary && activity.outcome ? activity.outcome : activity.outcome ? "Chỉ ghi nhận phản hồi" : "Chưa ghi kết quả"}</span></div>
      <div><strong>{activity.nextStep || "—"}</strong><span>{activity.dueDate ? `Hạn ${shortDate(activity.dueDate)}` : "Chưa có hạn"}</span></div>
      <label className="follow-up-inline-check"><input aria-label={`Đưa Follow-up ngày ${activity.activityDate} vào báo cáo tuần`} type="checkbox" checked={activity.includeInWeeklyReport} disabled={saving} onChange={() => void toggleReport(activity)}/><span>{activity.includeInWeeklyReport ? "Đã chọn" : "Không chọn"}</span></label>
      <div className="follow-up-row-actions"><button type="button" onClick={() => edit(activity)}>Sửa</button><button type="button" aria-label="Xóa Follow-up" onClick={() => void onDelete(activity)}>×</button></div>
    </article>)}</div>}
  </section>;
}
