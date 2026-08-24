export const STAGES = [
  { name: "Target Account", probability: 0.05 },
  { name: "Contacted", probability: 0.1 },
  { name: "Qualified", probability: 0.2 },
  { name: "Discovery", probability: 0.35 },
  { name: "Solution / Demo", probability: 0.5 },
  { name: "Quotation", probability: 0.65 },
  { name: "Negotiation", probability: 0.8 },
  { name: "Verbal Commit", probability: 0.9 },
  { name: "Closed Won", probability: 1 },
  { name: "Closed Lost", probability: 0 },
  { name: "Nurture", probability: 0.1 },
] as const;

export const ACCOUNT_TYPES = [
  "End-User",
  "Trading Partner",
  "System Integrator",
  "Existing Customer",
] as const;

export const LEAD_STATUSES = [
  "Chưa gửi",
  "Đã gửi",
  "Chờ phản hồi",
  "Có phản hồi",
  "Không quan tâm",
  "Email lỗi",
  "Đã chuyển cơ hội",
] as const;

export const BUYING_ROLES = [
  "Decision Maker",
  "Technical Influencer",
  "Procurement",
  "User",
  "Champion",
  "Gatekeeper",
] as const;

export const SCORE_FIELDS = [
  { key: "icpFit", label: "Độ phù hợp ICP", weight: 20 },
  { key: "needScore", label: "Mức độ nhu cầu", weight: 20 },
  { key: "authorityScore", label: "Quyền quyết định", weight: 15 },
  { key: "budgetScore", label: "Ngân sách", weight: 10 },
  { key: "timingScore", label: "Thời điểm mua", weight: 15 },
  { key: "engagementScore", label: "Mức tương tác", weight: 15 },
  { key: "channelScore", label: "Giá trị kênh", weight: 5 },
] as const;

export type StageName = (typeof STAGES)[number]["name"];
export type Temperature = "Hot" | "Warm" | "Cold";
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type Lead = {
  id: string;
  companyName: string;
  website: string;
  industry: string;
  accountType: string;
  contactName: string;
  title: string;
  email: string;
  phone: string;
  source: string;
  lastEmailDate: string;
  status: LeadStatus;
  nextFollowUpDate: string;
  emailSubject: string;
  replyNotes: string;
  notes: string;
  owner: string;
  convertedOpportunityId: string;
  convertedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type EmailSettingsPublic = {
  fromEmail: string;
  fromName: string;
  username: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "ssl" | "starttls";
  imapHost: string;
  imapPort: number;
  defaultSubject: string;
  defaultBody: string;
  configured: boolean;
  updatedAt: string;
};

export type EmailAsset = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  fileKind: "image" | "document";
  createdAt: string;
};

export type EmailMessageLog = {
  id: string;
  leadId: string;
  direction: "outbound" | "inbound";
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  status: "Sent" | "Received" | "Failed";
  providerMessageId: string;
  errorMessage: string;
  sentAt: string;
  receivedAt: string;
  createdAt: string;
};

export type Opportunity = {
  id: string;
  accountId: string;
  customerCode: string;
  companyName: string;
  accountType: string;
  industry: string;
  region: string;
  contactId: string;
  contactName: string;
  title: string;
  department: string;
  buyingRole: string;
  phone: string;
  email: string;
  zalo: string;
  preferredChannel: string;
  productApplication: string;
  needPain: string;
  stage: StageName;
  status: "Open" | "Won" | "Lost";
  estimatedValue: number;
  expectedCloseDate: string;
  actualCloseDate: string;
  lastContactDate: string;
  nextStep: string;
  nextStepDue: string;
  owner: string;
  icpFit: number;
  needScore: number;
  authorityScore: number;
  budgetScore: number;
  timingScore: number;
  engagementScore: number;
  channelScore: number;
  competitor: string;
  lostReason: string;
  notes: string;
  endUserCompany: string;
  endUserAddress: string;
  endUserIndustry: string;
  endUserContactName: string;
  endUserTitle: string;
  endUserPhone: string;
  endUserEmail: string;
  endUserNotes: string;
  createdAt: string;
  updatedAt: string;
  score: number;
  temperature: Temperature;
  probability: number;
  weightedValue: number;
  priority: "Quá hạn" | "Hôm nay" | "Sắp đến hạn" | "Thiếu Next Step" | "Đã lên lịch" | "Đã đóng";
};

export type Account = {
  id: string;
  customerCode: string;
  companyName: string;
  accountType: string;
  industry: string;
  region: string;
  website: string;
  owner: string;
  notes: string;
};

export type Contact = {
  id: string;
  accountId: string;
  fullName: string;
  title: string;
  department: string;
  buyingRole: string;
  phone: string;
  email: string;
  zalo: string;
  preferredChannel: string;
};

export type Activity = {
  id: string;
  opportunityId: string;
  activityDate: string;
  activityType: string;
  contactName: string;
  summary: string;
  outcome: string;
  nextStep: string;
  dueDate: string;
  owner: string;
  status: "Pending" | "Completed" | "Cancelled";
  includeInWeeklyReport: boolean;
  createdAt: string;
  updatedAt: string;
};

export type QuotationItem = {
  id: string;
  quotationId: string;
  lineNo: number;
  itemNumber: string;
  description: string;
  application: string;
  unit: string;
  quantity: number;
  productId: string;
  listPrice: number;
  discountPercent: number;
  origin: string;
  warranty: string;
  unitPrice: number;
  amount: number;
};

export type Product = {
  id: string;
  productFamily: string;
  modelGroup: string;
  marketModel: string;
  model: string;
  normalizedModel: string;
  itemNo: string;
  description: string;
  countryOfOrigin: string;
  listPriceUsd: number;
  listPriceVnd: number;
  itemStatus: string;
  grossWeight: string;
  uom: string;
  warrantyText: string;
  highTouch: boolean;
  priceSource: string;
  highTouchSource: string;
  updatedAt: string;
  stockQuantity?: number;
};

export type Quotation = {
  id: string;
  opportunityId: string;
  quotationNo: string;
  quoteDate: string;
  expirationDate: string;
  customerId: string;
  recipientCompany: string;
  recipientAddress: string;
  attention: string;
  recipientEmail: string;
  shippingMethod: string;
  shippingTerms: string;
  deliveryDate: string;
  paymentTerms: string;
  currency: string;
  vatRate: number;
  preparedBy: string;
  status: "Draft" | "Sent" | "Accepted" | "Expired";
  notes: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  items: QuotationItem[];
};

export type CrmData = {
  leads: Lead[];
  opportunities: Opportunity[];
  accounts: Account[];
  contacts: Contact[];
  activities: Activity[];
  quotations: Quotation[];
};

const dateOnly = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysBetween = (from: Date, to: Date) =>
  Math.floor((to.getTime() - from.getTime()) / 86_400_000);

export function getProbability(stage: string) {
  return STAGES.find((item) => item.name === stage)?.probability ?? 0;
}

export function calculateScore(
  opportunity: Pick<
    Opportunity,
    | "icpFit"
    | "needScore"
    | "authorityScore"
    | "budgetScore"
    | "timingScore"
    | "engagementScore"
    | "channelScore"
    | "lastContactDate"
    | "nextStep"
    | "nextStepDue"
    | "status"
  >,
  today = new Date(),
) {
  const base =
    (opportunity.icpFit / 5) * 20 +
    (opportunity.needScore / 5) * 20 +
    (opportunity.authorityScore / 5) * 15 +
    (opportunity.budgetScore / 5) * 10 +
    (opportunity.timingScore / 5) * 15 +
    (opportunity.engagementScore / 5) * 15 +
    (opportunity.channelScore / 5) * 5;

  let recencyAdjustment = -10;
  const lastContact = dateOnly(opportunity.lastContactDate);
  if (lastContact) {
    const age = daysBetween(lastContact, today);
    recencyAdjustment = age <= 7 ? 5 : age <= 14 ? 2 : age <= 30 ? 0 : age <= 60 ? -5 : -10;
  }

  let nextStepAdjustment = 0;
  if (opportunity.status === "Open") {
    const due = dateOnly(opportunity.nextStepDue);
    if (!opportunity.nextStep || !due) nextStepAdjustment = -10;
    else {
      const daysUntilDue = daysBetween(today, due);
      nextStepAdjustment = daysUntilDue < 0 ? -5 : daysUntilDue <= 7 ? 5 : 0;
    }
  }

  return Math.max(0, Math.min(100, Math.round(base + recencyAdjustment + nextStepAdjustment)));
}

export function getTemperature(score: number): Temperature {
  return score >= 75 ? "Hot" : score >= 50 ? "Warm" : "Cold";
}

export function getPriority(
  opportunity: Pick<Opportunity, "status" | "nextStep" | "nextStepDue">,
  today = new Date(),
): Opportunity["priority"] {
  if (opportunity.status !== "Open") return "Đã đóng";
  if (!opportunity.nextStep || !opportunity.nextStepDue) return "Thiếu Next Step";
  const due = dateOnly(opportunity.nextStepDue);
  if (!due) return "Thiếu Next Step";
  const days = daysBetween(today, due);
  if (days < 0) return "Quá hạn";
  if (days === 0) return "Hôm nay";
  if (days <= 7) return "Sắp đến hạn";
  return "Đã lên lịch";
}

export function enrichOpportunity<T extends Omit<Opportunity, "score" | "temperature" | "probability" | "weightedValue" | "priority">>(
  opportunity: T,
): Opportunity {
  const score = calculateScore(opportunity);
  const probability = getProbability(opportunity.stage);
  return {
    ...opportunity,
    score,
    temperature: getTemperature(score),
    probability,
    weightedValue: Math.round(opportunity.estimatedValue * probability),
    priority: getPriority(opportunity),
  };
}
