export type InventoryItem = {
  id: string;
  productId: string;
  materialCode: string;
  itemNo: string;
  description: string;
  unit: string;
  quantity: number;
  reportDate: string;
  sourceFile: string;
  updatedAt: string;
  matchedModel: string;
  highTouch: boolean;
};

export type InventorySummary = {
  skuCount: number;
  inStockSkuCount: number;
  totalQuantity: number;
  lowStockCount: number;
  unmatchedCount: number;
  reportDate: string;
  sourceFile: string;
};

export type WeeklyPlanItem = {
  dayKey: "Mon" | "Tue" | "Wed" | "Thu" | "Fri";
  label: string;
  mainActivity: string;
  location: string;
  remarks: string;
};

export type WeeklyProjectItem = {
  id: string;
  status: "A" | "C";
  projectName: string;
  customer: string;
  projectLead: string;
  startDate: string;
  preliminaryEndDate: string;
  adjustedEndDate: string;
  comments: string;
};

export type WeeklyReport = {
  id: string;
  weekStart: string;
  weekEnd: string;
  reportDate: string;
  weekNumber: number;
  reporter: string;
  status: "Draft" | "Submitted";
  sourceFile: string;
  plan: WeeklyPlanItem[];
  projects: WeeklyProjectItem[];
  createdAt: string;
  updatedAt: string;
};

export type WeeklyReportSummary = Pick<WeeklyReport,
  "id" | "weekStart" | "weekEnd" | "reportDate" | "weekNumber" | "status" | "updatedAt"
>;

const dateOnly = (value: string) => new Date(`${value}T00:00:00`);
const isoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function weekBounds(value = isoDate(new Date())) {
  const date = dateOnly(value);
  const day = date.getDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + offsetToMonday);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { weekStart: isoDate(monday), weekEnd: isoDate(friday) };
}

export function isoWeekNumber(value: string) {
  const date = dateOnly(value);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

export function emptyWeeklyReport(value = isoDate(new Date())): WeeklyReport {
  const { weekStart, weekEnd } = weekBounds(value);
  return {
    id: `WR-${weekStart}`,
    weekStart,
    weekEnd,
    reportDate: weekEnd,
    weekNumber: isoWeekNumber(weekStart),
    reporter: "Mai Trần Thành",
    status: "Draft",
    sourceFile: "",
    plan: [
      { dayKey: "Mon", label: "Thứ Hai", mainActivity: "", location: "Văn phòng", remarks: "" },
      { dayKey: "Tue", label: "Thứ Ba", mainActivity: "", location: "Văn phòng", remarks: "" },
      { dayKey: "Wed", label: "Thứ Tư", mainActivity: "", location: "Văn phòng", remarks: "" },
      { dayKey: "Thu", label: "Thứ Năm", mainActivity: "", location: "Văn phòng", remarks: "" },
      { dayKey: "Fri", label: "Thứ Sáu", mainActivity: "", location: "Văn phòng", remarks: "" },
    ],
    projects: [],
    createdAt: "",
    updatedAt: "",
  };
}
