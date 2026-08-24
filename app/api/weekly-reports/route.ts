import { ensureDatabase } from "@/db";
import { companyWeekNumber, emptyWeeklyReport, isoWeekNumber, type WeeklyPlanItem, type WeeklyProjectItem, type WeeklyReport, type WeeklyReportSummary } from "@/lib/operations";

type Input = Record<string, unknown>;
type WeeklyRow = Omit<WeeklyReport, "plan" | "projects"> & { planJson: string; projectsJson: string };

const textValue = (input: Input, key: string, fallback = "") => {
  const value = input[key];
  return typeof value === "string" ? value.trim() : fallback;
};

const dateValue = (input: Input, key: string, fallback: string) => {
  const value = textValue(input, key, fallback);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
};

const numberValue = (input: Input, key: string, fallback: number) => {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
};

const parseJson = <T,>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

const rowToReport = (row: WeeklyRow): WeeklyReport => ({
  ...row,
  plan: parseJson<WeeklyPlanItem[]>(row.planJson, []),
  projects: parseJson<WeeklyProjectItem[]>(row.projectsJson, []),
});

const correctLegacyWeekNumber = <T extends { weekStart: string; weekNumber: number }>(report: T): T =>
  report.weekNumber === isoWeekNumber(report.weekStart)
    ? { ...report, weekNumber: companyWeekNumber(report.weekStart) }
    : report;

async function loadReport(request: Request) {
  const db = await ensureDatabase();
  const url = new URL(request.url);
  const requested = url.searchParams.get("weekStart") ?? new Date().toISOString().slice(0, 10);
  const empty = emptyWeeklyReport(requested);
  const row = await db.prepare(`SELECT id, week_start AS weekStart, week_end AS weekEnd, report_date AS reportDate,
      week_number AS weekNumber, reporter, status, source_file AS sourceFile, plan_json AS planJson,
      projects_json AS projectsJson, created_at AS createdAt, updated_at AS updatedAt
    FROM weekly_reports WHERE week_start = ?`).bind(empty.weekStart).first<WeeklyRow>();
  const recent = await db.prepare(`SELECT id, week_start AS weekStart, week_end AS weekEnd, report_date AS reportDate,
      week_number AS weekNumber, status, updated_at AS updatedAt FROM weekly_reports ORDER BY week_start DESC LIMIT 16`)
    .all<WeeklyReportSummary>();
  return {
    report: row ? correctLegacyWeekNumber(rowToReport(row)) : empty,
    recent: (recent.results ?? []).map(correctLegacyWeekNumber),
  };
}

async function saveReport(input: Input) {
  const db = await ensureDatabase();
  const empty = emptyWeeklyReport(textValue(input, "weekStart", new Date().toISOString().slice(0, 10)));
  const rawPlan = Array.isArray(input.plan) ? input.plan.filter((item): item is Input => Boolean(item) && typeof item === "object") : [];
  const rawProjects = Array.isArray(input.projects) ? input.projects.filter((item): item is Input => Boolean(item) && typeof item === "object") : [];
  const plan: WeeklyPlanItem[] = empty.plan.map((defaultItem, index) => {
    const item = rawPlan[index] ?? {};
    return { ...defaultItem, mainActivity: textValue(item, "mainActivity"), location: textValue(item, "location", "Văn phòng"), remarks: textValue(item, "remarks") };
  });
  const projects: WeeklyProjectItem[] = rawProjects.slice(0, 100).flatMap((item) => {
    const projectName = textValue(item, "projectName");
    const customer = textValue(item, "customer");
    const comments = textValue(item, "comments");
    if (!projectName && !customer && !comments) return [];
    return [{
      id: textValue(item, "id") || `WPI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      status: textValue(item, "status") === "C" ? "C" as const : "A" as const,
      projectName, customer, projectLead: textValue(item, "projectLead"),
      startDate: textValue(item, "startDate"), preliminaryEndDate: textValue(item, "preliminaryEndDate"),
      adjustedEndDate: textValue(item, "adjustedEndDate"), comments,
    }];
  });
  const now = new Date().toISOString();
  const id = `WR-${empty.weekStart}`;
  await db.prepare(`INSERT INTO weekly_reports (id, week_start, week_end, report_date, week_number, reporter, status,
      source_file, plan_json, projects_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(week_start) DO UPDATE SET week_end = excluded.week_end, report_date = excluded.report_date,
      week_number = excluded.week_number, reporter = excluded.reporter, status = excluded.status,
      source_file = excluded.source_file, plan_json = excluded.plan_json, projects_json = excluded.projects_json,
      updated_at = excluded.updated_at`)
    .bind(id, empty.weekStart, empty.weekEnd, dateValue(input, "reportDate", empty.weekEnd), Math.max(1, Math.min(54, Math.round(numberValue(input, "weekNumber", empty.weekNumber)))),
      textValue(input, "reporter", "Mai Trần Thành"), textValue(input, "status") === "Submitted" ? "Submitted" : "Draft",
      textValue(input, "sourceFile"), JSON.stringify(plan), JSON.stringify(projects), now, now).run();
}

export async function GET(request: Request) {
  try {
    return Response.json(await loadReport(request));
  } catch (error) {
    console.error("Weekly report load failed", error);
    return Response.json({ error: "Không thể tải báo cáo tuần." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as Input;
    if (textValue(input, "action") !== "save") throw new Error("Thao tác báo cáo tuần không hợp lệ.");
    await saveReport(input);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể lưu báo cáo tuần.";
    console.error("Weekly report mutation failed", error);
    return Response.json({ error: message }, { status: 400 });
  }
}
