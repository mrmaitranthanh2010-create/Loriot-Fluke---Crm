"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ACCOUNT_TYPES,
  BUYING_ROLES,
  SCORE_FIELDS,
  calculateScore,
  getTemperature,
  type Account,
  type Activity,
  type Contact,
  type CrmData,
  type Lead,
  type Opportunity,
  type Product,
  type Quotation,
  type QuotationItem,
  type StageName,
} from "@/lib/crm";
import { LeadView, type LeadDraft } from "@/app/lead-view";
import { FollowUpPanel, type ActivityDraft } from "@/app/follow-up-panel";
import { generateQuotationXlsx } from "@/lib/quotation-xlsx";
import { InventoryView, WeeklyReportsView } from "@/app/operations-views";
import { parseHighTouchXlsx, parsePriceListXlsx, parseQuotationWorkbookXlsx } from "@/lib/product-xlsx";
import {
  calculateVndPrice,
  vietnamGreeting,
  type PricingSettings,
  type PricingSettingsInput,
} from "@/lib/pricing";

type View = "dashboard" | "leads" | "actions" | "pipeline" | "records" | "quotations" | "sales" | "products" | "inventory" | "weekly";
type IconName = "grid" | "check" | "pipeline" | "users" | "file" | "box" | "upload" | "download" | "trash" | "plus" | "search" | "bell" | "money" | "target" | "fire" | "clock" | "arrow" | "edit" | "close" | "building" | "person" | "briefcase" | "chevron" | "refresh" | "phone" | "mail";

type Draft = {
  id: string;
  sourceLeadId: string;
  customerCode: string;
  companyName: string;
  accountType: string;
  industry: string;
  region: string;
  website: string;
  accountNotes: string;
  contactName: string;
  title: string;
  department: string;
  buyingRole: string;
  phone: string;
  email: string;
  zalo: string;
  preferredChannel: string;
  productApplication: string;
  productLines: OpportunityProductLine[];
  needPain: string;
  stage: StageName;
  estimatedValue: number;
  expectedCloseDate: string;
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
};

type OpportunityProductLine = {
  model: string;
  description: string;
  quantity: number;
  listPrice: number;
};

type QuoteItemDraft = Pick<QuotationItem,
  "productId" | "itemNumber" | "description" | "application" | "unit" | "quantity" | "listPrice" | "discountPercent" | "origin" | "warranty" | "unitPrice"
>;
type QuoteDraft = Omit<Quotation, "items" | "subtotal" | "vatAmount" | "total" | "createdAt" | "updatedAt"> & { items: QuoteItemDraft[] };
type ProductDraft = Omit<Product, "normalizedModel" | "updatedAt">;

type CustomerSalesRow = {
  accountId: string;
  companyName: string;
  accountType: string;
  region: string;
  cumulativeRevenue: number;
  yearRevenue: number;
  orderCount: number;
  lastOrderDate: string;
  lastQuotationNo: string;
};

type PipelineGroup = {
  key: string;
  label: string;
  description: string;
  stages: readonly StageName[];
  moveTo: StageName;
};

const PRODUCT_SUGGESTION_CACHE_TTL = 2 * 60 * 1_000;
const PRODUCT_SUGGESTION_CACHE = new Map<string, { products: Product[]; expiresAt: number }>();
const PRODUCT_SUGGESTION_REQUESTS = new Map<string, Promise<Product[]>>();
const clearProductSuggestionCache = () => {
  PRODUCT_SUGGESTION_CACHE.clear();
  PRODUCT_SUGGESTION_REQUESTS.clear();
};

const productSuggestionKey = (value: string) => value.toLocaleUpperCase("vi").replace(/\s+/g, " ").trim();

const cachedProductSuggestions = (query: string) => {
  const now = Date.now();
  const exact = PRODUCT_SUGGESTION_CACHE.get(query);
  if (exact?.expiresAt && exact.expiresAt > now) return { products: exact.products, exact: true };
  let nearest: { key: string; products: Product[] } | null = null;
  for (const [key, entry] of PRODUCT_SUGGESTION_CACHE) {
    if (entry.expiresAt <= now) {
      PRODUCT_SUGGESTION_CACHE.delete(key);
      continue;
    }
    if (query.startsWith(key) && (!nearest || key.length > nearest.key.length)) {
      nearest = { key, products: entry.products };
    }
  }
  if (!nearest) return { products: [], exact: false };
  return {
    products: nearest.products.filter((product) => [product.model, product.itemNo, product.marketModel]
      .some((value) => productSuggestionKey(value).includes(query))),
    exact: false,
  };
};

const requestProductSuggestions = (query: string) => {
  const pending = PRODUCT_SUGGESTION_REQUESTS.get(query);
  if (pending) return pending;
  const request = fetch(`/api/products?mode=suggest&q=${encodeURIComponent(query)}&limit=12`, { cache: "no-store" })
    .then(async (response) => {
      const result = await response.json() as { products?: Product[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể tìm Model.");
      const products = result.products ?? [];
      PRODUCT_SUGGESTION_CACHE.set(query, {
        products,
        expiresAt: Date.now() + PRODUCT_SUGGESTION_CACHE_TTL,
      });
      return products;
    })
    .finally(() => PRODUCT_SUGGESTION_REQUESTS.delete(query));
  PRODUCT_SUGGESTION_REQUESTS.set(query, request);
  return request;
};

const normalizeSearchText = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("vi")
  .replace(/\s+/g, " ")
  .trim();

const opportunitySearchLabel = (opportunity: Opportunity) => [
  opportunity.customerCode,
  opportunity.companyName,
  opportunity.endUserCompany ? `→ ${opportunity.endUserCompany}` : "",
  opportunity.productApplication,
].filter(Boolean).join(" · ");

const PIPELINE_GROUPS: readonly PipelineGroup[] = [
  { key: "contact", label: "Tiếp cận", description: "Lead mới và đã liên hệ", stages: ["Target Account", "Contacted"], moveTo: "Target Account" },
  { key: "solution", label: "Nhu cầu và giải pháp", description: "Tìm hiểu nhu cầu, tư vấn giải pháp", stages: ["Qualified", "Discovery", "Solution / Demo"], moveTo: "Discovery" },
  { key: "quotation", label: "Báo giá", description: "Đã gửi báo giá cho khách", stages: ["Quotation"], moveTo: "Quotation" },
  { key: "closing", label: "Đàm phán", description: "Thương lượng và chờ xác nhận", stages: ["Negotiation", "Verbal Commit"], moveTo: "Negotiation" },
  { key: "nurture", label: "Nuôi dưỡng", description: "Chưa mua ngay, cần theo dõi lại", stages: ["Nurture"], moveTo: "Nurture" },
  { key: "closed", label: "Đóng dự án", description: "Dự án thành công hoặc thất bại", stages: ["Closed Won", "Closed Lost"], moveTo: "Closed Won" },
];

const pipelineGroupForStage = (stage: StageName) => PIPELINE_GROUPS.find((group) => group.stages.includes(stage)) ?? PIPELINE_GROUPS[0];

const stageDisplayLabel = (stage: StageName) => {
  const group = pipelineGroupForStage(stage);
  if (stage === "Closed Won") return `${group.label} · Thành công`;
  if (stage === "Closed Lost") return `${group.label} · Thất bại`;
  return group.label;
};

const stripLegacyQuoteMetadata = (value: string) => {
  const metadataIndex = value.search(/\b(?:maker|origin|warranty|bảo hành)\s*:/i);
  return (metadataIndex >= 0 ? value.slice(0, metadataIndex) : value)
    .replace(/[,;.\s]+$/g, "")
    .trim();
};

const parseOpportunityProductLines = (value: string): OpportunityProductLine[] => {
  const lines = value.split(/\r?\n/).map((rawLine) => {
    const line = stripLegacyQuoteMetadata(rawLine.trim());
    if (!line) return null;
    const separatorIndex = line.indexOf(" — ");
    const legacyCommaIndex = line.indexOf(",");
    const legacyModel = legacyCommaIndex > 0 ? line.slice(0, legacyCommaIndex).trim() : "";
    const looksLikeLegacyModel = legacyModel.length <= 48
      && /\d/.test(legacyModel)
      && /^[A-Z0-9][A-Z0-9+./_()\- ]*$/i.test(legacyModel);
    if (separatorIndex < 0 && looksLikeLegacyModel) {
      return {
        model: legacyModel,
        description: stripLegacyQuoteMetadata(line.slice(legacyCommaIndex + 1)),
        quantity: 1,
        listPrice: 0,
      };
    }
    if (separatorIndex < 0) return { model: "", description: line, quantity: 1, listPrice: 0 };
    const modelWithQuantity = line.slice(0, separatorIndex).trim();
    const quantityMatch = modelWithQuantity.match(/^(.*?)\s+×(\d+)$/);
    return {
      model: (quantityMatch?.[1] ?? modelWithQuantity).trim(),
      description: stripLegacyQuoteMetadata(line.slice(separatorIndex + 3)),
      quantity: Math.max(1, Number(quantityMatch?.[2]) || 1),
      listPrice: 0,
    };
  }).filter((line): line is OpportunityProductLine => Boolean(line));
  return lines.length ? lines : [{ model: "", description: "", quantity: 1, listPrice: 0 }];
};

const formatOpportunityProductLines = (lines: OpportunityProductLine[]) => lines
  .map((line) => {
    const model = line.model.trim();
    const description = stripLegacyQuoteMetadata(line.description.replace(/\s*\r?\n+\s*/g, " "));
    return [
      `${model}${model && line.quantity > 1 ? ` ×${line.quantity}` : ""}`,
      description,
    ].filter(Boolean).join(" — ");
  })
  .filter(Boolean)
  .join("\n");

const normalizeCustomerCode = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, "")
  .slice(0, 16);

const emptyProduct = (): ProductDraft => ({
  id: "", productFamily: "", modelGroup: "", marketModel: "", model: "", itemNo: "", description: "",
  countryOfOrigin: "", listPriceUsd: 0, listPriceVnd: 0, itemStatus: "ACTIVE", grossWeight: "", uom: "EA",
  warrantyText: "12 tháng", highTouch: false, priceSource: "Cập nhật thủ công", highTouchSource: "",
});

const emptyDraft = (): Draft => ({
  id: "",
  sourceLeadId: "",
  customerCode: "",
  companyName: "",
  accountType: "End-User",
  industry: "",
  region: "",
  website: "",
  accountNotes: "",
  contactName: "",
  title: "",
  department: "",
  buyingRole: "Technical Influencer",
  phone: "",
  email: "",
  zalo: "",
  preferredChannel: "Zalo",
  productApplication: "",
  productLines: [{ model: "", description: "", quantity: 1, listPrice: 0 }],
  needPain: "",
  stage: "Target Account",
  estimatedValue: 0,
  expectedCloseDate: "",
  lastContactDate: new Date().toISOString().slice(0, 10),
  nextStep: "",
  nextStepDue: "",
  owner: "Mai Trần Thành",
  icpFit: 3,
  needScore: 3,
  authorityScore: 2,
  budgetScore: 2,
  timingScore: 2,
  engagementScore: 2,
  channelScore: 0,
  competitor: "",
  lostReason: "",
  notes: "",
  endUserCompany: "",
  endUserAddress: "",
  endUserIndustry: "",
  endUserContactName: "",
  endUserTitle: "",
  endUserPhone: "",
  endUserEmail: "",
  endUserNotes: "",
});

const fromOpportunity = (opportunity: Opportunity): Draft => ({
  id: opportunity.id,
  sourceLeadId: "",
  customerCode: opportunity.customerCode,
  companyName: opportunity.companyName,
  accountType: opportunity.accountType,
  industry: opportunity.industry,
  region: opportunity.region,
  website: "",
  accountNotes: "",
  contactName: opportunity.contactName,
  title: opportunity.title,
  department: opportunity.department,
  buyingRole: opportunity.buyingRole,
  phone: opportunity.phone,
  email: opportunity.email,
  zalo: opportunity.zalo,
  preferredChannel: opportunity.preferredChannel,
  productApplication: opportunity.productApplication,
  productLines: parseOpportunityProductLines(opportunity.productApplication),
  needPain: opportunity.needPain,
  stage: opportunity.stage,
  estimatedValue: opportunity.estimatedValue,
  expectedCloseDate: opportunity.expectedCloseDate,
  lastContactDate: opportunity.lastContactDate,
  nextStep: opportunity.nextStep,
  nextStepDue: opportunity.nextStepDue,
  owner: opportunity.owner,
  icpFit: opportunity.icpFit,
  needScore: opportunity.needScore,
  authorityScore: opportunity.authorityScore,
  budgetScore: opportunity.budgetScore,
  timingScore: opportunity.timingScore,
  engagementScore: opportunity.engagementScore,
  channelScore: opportunity.channelScore,
  competitor: opportunity.competitor,
  lostReason: opportunity.lostReason,
  notes: opportunity.notes,
  endUserCompany: opportunity.endUserCompany,
  endUserAddress: opportunity.endUserAddress,
  endUserIndustry: opportunity.endUserIndustry,
  endUserContactName: opportunity.endUserContactName,
  endUserTitle: opportunity.endUserTitle,
  endUserPhone: opportunity.endUserPhone,
  endUserEmail: opportunity.endUserEmail,
  endUserNotes: opportunity.endUserNotes,
});

const fromLeadToOpportunity = (lead: Lead): Draft => ({
  ...emptyDraft(),
  sourceLeadId: lead.id,
  companyName: lead.companyName,
  accountType: lead.accountType || "End-User",
  industry: lead.industry,
  website: lead.website,
  contactName: lead.contactName,
  title: lead.title,
  phone: lead.phone,
  email: lead.email,
  preferredChannel: "Email",
  stage: lead.status === "Có phản hồi" ? "Qualified" : "Contacted",
  lastContactDate: lead.lastEmailDate || new Date().toISOString().slice(0, 10),
  nextStep: "Xác minh nhu cầu sau phản hồi Lead",
  nextStepDue: lead.nextFollowUpDate,
  notes: [lead.replyNotes, lead.notes, `Chuyển từ Lead ${lead.id} · Nguồn: ${lead.source || "Email Outbound"}`].filter(Boolean).join("\n"),
});

const quoteSequence = (date: string, rawCustomerCode: string, quotations: Quotation[], excludedId = "") => {
  const customerCode = normalizeCustomerCode(rawCustomerCode);
  const matching = quotations.filter((quotation) => quotation.id !== excludedId
    && normalizeCustomerCode(quotation.customerId) === customerCode);
  const maxSequence = matching.reduce((max, quotation) => {
    const sequence = Number(quotation.quotationNo.match(/-(\d+)$/)?.[1] ?? 0);
    return Math.max(max, sequence);
  }, 0);
  const nextSequence = Math.max(maxSequence, matching.length) + 1;
  return `LOR${date.replaceAll("-", "")}${customerCode || "KHACH"}-${nextSequence}`;
};

const emptyQuote = (opportunity: Opportunity, quotations: Quotation[], sourceProductLines?: OpportunityProductLine[]): QuoteDraft => {
  const today = new Date().toISOString().slice(0, 10);
  const customerCode = normalizeCustomerCode(opportunity.customerCode);
  const expiration = new Date(`${today}T00:00:00`);
  expiration.setDate(expiration.getDate() + 15);
  const productLines = (sourceProductLines ?? parseOpportunityProductLines(opportunity.productApplication))
    .filter((line) => line.model || line.description);
  const items = (productLines.length ? productLines : [{ model: "", description: "", quantity: 1, listPrice: 0 }]).map((line) => ({
    productId: "", itemNumber: line.model, description: line.description, application: line.description,
    unit: "PCS", quantity: line.quantity, listPrice: line.listPrice, discountPercent: 0, origin: "", warranty: "12 tháng", unitPrice: line.listPrice,
  }));
  return {
    id: "",
    opportunityId: opportunity.id,
    quotationNo: quoteSequence(today, customerCode, quotations),
    quoteDate: today,
    expirationDate: expiration.toISOString().slice(0, 10),
    customerId: customerCode,
    recipientCompany: opportunity.companyName,
    recipientAddress: opportunity.region,
    attention: opportunity.contactName,
    recipientEmail: opportunity.email,
    shippingMethod: "Air Shipment",
    shippingTerms: "DDP",
    deliveryDate: "2-4 Weeks",
    paymentTerms: "100% TT",
    currency: "VND",
    vatRate: 8,
    preparedBy: "MAI TRẦN THÀNH (+84 964 72 72 33)",
    status: "Draft",
    notes: opportunity.endUserCompany ? `End-User nội bộ: ${opportunity.endUserCompany}` : "",
    items,
  };
};

const fromQuotation = (quotation: Quotation): QuoteDraft => ({
  ...quotation,
  items: quotation.items.map(({ productId, itemNumber, description, application, unit, quantity, listPrice, discountPercent, origin, warranty, unitPrice }) => ({
    productId: productId || "", itemNumber, description, application: application || "", unit, quantity, listPrice: listPrice || unitPrice,
    discountPercent: discountPercent || 0, origin: origin || "", warranty: warranty || "12 tháng", unitPrice,
  })),
});

const iconPaths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  check: <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
  pipeline: <><path d="M4 5h16M7 12h10M10 19h4"/><circle cx="4" cy="5" r="1"/><circle cx="7" cy="12" r="1"/><circle cx="10" cy="19" r="1"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></>,
  box: <><path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5v9l9-5V8M7.5 5.5l9 5"/></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  money: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 9h2M6 15H4"/><circle cx="12" cy="12" r="3"/></>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  fire: <><path d="M12 22c4 0 7-3 7-7 0-3-2-6-5-9 0 3-2 5-4 6 0-3-1-5-2-7-2 3-3 6-3 9 0 5 3 8 7 8Z"/><path d="M10 19c-1-2 0-4 2-6 0 2 2 3 2 5 0 1-1 2-2 2"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
  edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
  close: <><path d="M18 6 6 18M6 6l12 12"/></>,
  building: <><path d="M3 21h18M6 21V5l6-2v18M18 21V9l-6-2"/><path d="M9 8h1M9 12h1M9 16h1M15 12h1M15 16h1"/></>,
  person: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/></>,
  chevron: <><path d="m9 18 6-6-6-6"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6l2 6M17.9 15A7 7 0 0 1 6 18l-2-6"/></>,
  phone: <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.2 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .37 1.98.72 2.91a2 2 0 0 1-.45 2.11L8.1 10a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.93.35 1.91.59 2.91.72A2 2 0 0 1 22 16.92Z"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}

const money = (value: number) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);
const formatMoneyInput = (value: number, decimals = 0) => value > 0
  ? new Intl.NumberFormat(decimals === 0 ? "vi-VN" : "en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value)
  : "";
const parseMoneyInput = (text: string, decimals = 0) => {
  const cleaned = text.replace(/[^\d.,]/g, "");
  if (!cleaned) return 0;
  if (decimals === 0) return Number(cleaned.replace(/\D/g, "")) || 0;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const separatorIndex = Math.max(lastDot, lastComma);
  const decimalLength = separatorIndex >= 0 ? cleaned.length - separatorIndex - 1 : 0;
  const hasBothSeparators = lastDot >= 0 && lastComma >= 0;
  const usesDecimalSeparator = separatorIndex >= 0 && (hasBothSeparators || decimalLength <= decimals);
  const whole = usesDecimalSeparator ? cleaned.slice(0, separatorIndex).replace(/\D/g, "") : cleaned.replace(/\D/g, "");
  const fraction = usesDecimalSeparator ? cleaned.slice(separatorIndex + 1).replace(/\D/g, "").slice(0, decimals) : "";
  return Number(fraction ? `${whole || "0"}.${fraction}` : whole) || 0;
};
const quoteMoney = (value: number, currency: string) => {
  const normalized = currency.toUpperCase() === "VNĐ" ? "VND" : currency.toUpperCase() || "VND";
  return new Intl.NumberFormat(normalized === "VND" ? "vi-VN" : "en-US", {
    style: "currency", currency: normalized, maximumFractionDigits: normalized === "VND" ? 0 : 2,
  }).format(value);
};
const compactMoney = (value: number) => money(value);
const shortDate = (value: string) => value ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`)) : "—";

function MoneyInput({ value, onChange, decimals = 0, required, disabled, placeholder, ariaLabel }: {
  value: number;
  onChange: (value: number) => void;
  decimals?: number;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => formatMoneyInput(value, decimals));
  useEffect(() => {
    if (!focused) setText(formatMoneyInput(value, decimals));
  }, [value, decimals, focused]);

  return <input
    className="money-input"
    type="text"
    inputMode={decimals === 0 ? "numeric" : "decimal"}
    required={required}
    disabled={disabled}
    value={text}
    placeholder={placeholder}
    aria-label={ariaLabel}
    onFocus={() => {
      setFocused(true);
      if (decimals > 0) setText(value > 0 ? String(value) : "");
    }}
    onChange={(event) => {
      const parsed = parseMoneyInput(event.target.value, decimals);
      onChange(parsed);
      setText(decimals === 0 ? formatMoneyInput(parsed, 0) : event.target.value);
    }}
    onBlur={() => {
      setFocused(false);
      setText(formatMoneyInput(parseMoneyInput(text, decimals), decimals));
    }}
  />;
}

function Temperature({ value, score }: { value: Opportunity["temperature"]; score?: number }) {
  return <span className={`temperature temperature-${value.toLowerCase()}`}><span />{value}{typeof score === "number" ? ` · ${score}` : ""}</span>;
}

function Priority({ value }: { value: Opportunity["priority"] }) {
  return <span className={`priority priority-${value.replaceAll(" ", "-").toLowerCase()}`}>{value}</span>;
}

function MetricCard({ label, value, detail, icon, tone = "navy" }: { label: string; value: string; detail: string; icon: IconName; tone?: string }) {
  return <article className="metric-card">
    <div className={`metric-icon metric-${tone}`}><Icon name={icon} size={21}/></div>
    <div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div>
  </article>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="target" size={25}/></div><strong>{title}</strong><p>{text}</p></div>;
}

function LoadingScreen() {
  return <div className="loading-screen"><div className="loading-mark"><span>L</span></div><strong>Đang mở Loriot CRM</strong><div className="loading-bar"><span /></div></div>;
}

export function CrmApp() {
  const [data, setData] = useState<CrmData | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("Tất cả giai đoạn");
  const [temperatureFilter, setTemperatureFilter] = useState("Tất cả nhiệt độ");
  const [typeFilter, setTypeFilter] = useState("Tất cả loại khách");
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState<QuoteDraft | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productSearch, setProductSearch] = useState("");
  const [highTouchOnly, setHighTouchOnly] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [productRefresh, setProductRefresh] = useState(0);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyProduct());
  const [pricing, setPricing] = useState<PricingSettings | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setError("");
    try {
      const response = await fetch("/api/crm", { cache: "no-store" });
      const result = await response.json() as CrmData & { error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể tải dữ liệu.");
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu CRM.");
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/crm", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as CrmData & { error?: string };
        if (!response.ok) throw new Error(result.error || "Không thể tải dữ liệu.");
        if (active) setData(result);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu CRM.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const refreshPricing = async () => {
      if (active) setPricingLoading(true);
      try {
        const response = await fetch("/api/pricing", { cache: "no-store" });
        const result = await response.json() as PricingSettings & { error?: string };
        if (!response.ok) throw new Error(result.error || "Không thể tải tỷ giá USD/VND.");
        if (active) {
          clearProductSuggestionCache();
          setPricing(result);
          setProductRefresh((value) => value + 1);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không thể tải tỷ giá USD/VND.");
      } finally {
        if (active) setPricingLoading(false);
      }
    };
    void refreshPricing();
    const timer = window.setInterval(refreshPricing, 5 * 60 * 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (view !== "products") return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (active) setProductLoading(true);
      try {
        const params = new URLSearchParams({ q: productSearch, limit: "120" });
        if (highTouchOnly) params.set("highTouch", "1");
        const response = await fetch(`/api/products?${params}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { products?: Product[]; total?: number; error?: string };
        if (!response.ok) throw new Error(result.error || "Không thể tải danh mục sản phẩm.");
        if (active) {
          setProducts(result.products ?? []);
          setProductTotal(result.total ?? 0);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (active) setError(loadError instanceof Error ? loadError.message : "Không thể tải danh mục sản phẩm.");
      } finally {
        if (active) setProductLoading(false);
      }
    }, 80);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [view, productSearch, highTouchOnly, productRefresh]);

  useEffect(() => {
    if (!notificationOpen) return;
    const closeWhenClickingOutside = (event: MouseEvent) => {
      if (!notificationRef.current?.contains(event.target as Node)) setNotificationOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationOpen(false);
    };
    document.addEventListener("mousedown", closeWhenClickingOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeWhenClickingOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [notificationOpen]);

  const mutate = async (payload: Record<string, unknown>, successMessage: string) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as CrmData & { error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể lưu thay đổi.");
      setData(result);
      setNotice(successMessage);
      window.setTimeout(() => setNotice(""), 2800);
      return result;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Không thể lưu thay đổi.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const opportunities = useMemo(() => data?.opportunities ?? [], [data]);
  const opportunityFilterIndex = useMemo(() => opportunities.map((item) => ({
    item,
    text: normalizeSearchText([
      item.customerCode,
      item.companyName,
      item.contactName,
      item.productApplication,
      item.endUserCompany,
      item.endUserContactName,
      item.id,
      item.nextStep,
    ].join(" ")),
  })), [opportunities]);
  const openOpportunities = opportunities.filter((item) => item.status === "Open");
  const activeValue = openOpportunities.reduce((sum, item) => sum + item.estimatedValue, 0);
  const weightedValue = openOpportunities.reduce((sum, item) => sum + item.weightedValue, 0);
  const hotCount = openOpportunities.filter((item) => item.temperature === "Hot").length;
  const overdueCount = openOpportunities.filter((item) => item.priority === "Quá hạn" || item.priority === "Hôm nay").length;
  const wonOpportunities = opportunities.filter((item) => item.status === "Won");
  const lostOpportunities = opportunities.filter((item) => item.status === "Lost");
  const wonValue = wonOpportunities.reduce((sum, item) => sum + item.estimatedValue, 0);
  const winRate = wonOpportunities.length + lostOpportunities.length > 0 ? wonOpportunities.length / (wonOpportunities.length + lostOpportunities.length) : 0;

  const actionItems = useMemo(() => {
    const priorityOrder: Record<Opportunity["priority"], number> = { "Quá hạn": 0, "Hôm nay": 1, "Sắp đến hạn": 2, "Thiếu Next Step": 3, "Đã lên lịch": 4, "Đã đóng": 5 };
    return opportunities.filter((item) => item.status === "Open").sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || b.score - a.score);
  }, [opportunities]);
  const urgentNotifications = useMemo(
    () => actionItems.filter((item) => item.priority === "Quá hạn" || item.priority === "Hôm nay"),
    [actionItems],
  );

  const filtered = useMemo(() => {
    const query = normalizeSearchText(search);
    return opportunityFilterIndex.filter(({ item, text }) => {
      const matchesSearch = !query || text.includes(query);
      const matchesStage = stageFilter === "Tất cả giai đoạn" || pipelineGroupForStage(item.stage).key === stageFilter;
      const matchesTemperature = temperatureFilter === "Tất cả nhiệt độ" || item.temperature === temperatureFilter;
      const matchesType = typeFilter === "Tất cả loại khách" || item.accountType === typeFilter;
      return matchesSearch && matchesStage && matchesTemperature && matchesType;
    }).map(({ item }) => item);
  }, [opportunityFilterIndex, search, stageFilter, temperatureFilter, typeFilter]);

  const openCreate = () => { setDraft(emptyDraft()); setModalOpen(true); };
  const openEdit = (opportunity: Opportunity) => { setDraft(fromOpportunity(opportunity)); setModalOpen(true); };
  const convertLead = (lead: Lead) => {
    setDraft(fromLeadToOpportunity(lead));
    setModalOpen(true);
    setNotice("Thông tin Lead đã được điền sẵn. Bổ sung mã khách hàng, sản phẩm/ứng dụng và lưu cơ hội.");
    window.setTimeout(() => setNotice(""), 4200);
  };
  const saveLead = async (lead: LeadDraft) => Boolean(await mutate(
    { action: "saveLead", ...lead },
    lead.id ? "Đã cập nhật Lead." : "Đã thêm Lead vào danh sách Email Outbound.",
  ));
  const deleteLead = async (lead: Lead) => {
    const relation = lead.convertedOpportunityId ? " Cơ hội đã chuyển đổi vẫn được giữ nguyên trong CRM." : "";
    if (!window.confirm(`Xóa Lead "${lead.companyName}" khỏi danh sách tìm kiếm?${relation}`)) return;
    await mutate({ action: "deleteLead", id: lead.id }, "Đã xóa Lead khỏi danh sách tìm kiếm.");
  };
  const saveActivity = async (activity: ActivityDraft) => {
    const result = await mutate(
      { action: "saveActivity", ...activity },
      activity.id ? "Đã cập nhật dòng Follow-up." : "Đã lưu Follow-up và cập nhật Next Step hiện tại.",
    );
    if (result && !activity.id && draft.id === activity.opportunityId) {
      setDraft({
        ...draft,
        lastContactDate: activity.activityDate,
        nextStep: activity.nextStep || draft.nextStep,
        nextStepDue: activity.dueDate || draft.nextStepDue,
      });
    }
    return Boolean(result);
  };
  const deleteActivity = async (activity: Activity) => {
    if (!window.confirm(`Xóa dòng Follow-up ngày ${shortDate(activity.activityDate)}?`)) return;
    await mutate({ action: "deleteActivity", id: activity.id }, "Đã xóa dòng Follow-up.");
  };
  const openQuote = (opportunity: Opportunity, quotation?: Quotation, sourceProductLines?: OpportunityProductLine[]) => {
    setQuoteDraft(quotation ? fromQuotation(quotation) : emptyQuote(opportunity, data?.quotations ?? [], sourceProductLines));
    setQuoteModalOpen(true);
  };

  const openProduct = (product?: Product) => {
    setProductDraft(product ? {
      id: product.id, productFamily: product.productFamily, modelGroup: product.modelGroup,
      marketModel: product.marketModel, model: product.model, itemNo: product.itemNo,
      description: product.description, countryOfOrigin: product.countryOfOrigin,
      listPriceUsd: product.listPriceUsd, listPriceVnd: product.listPriceVnd, itemStatus: product.itemStatus,
      grossWeight: product.grossWeight, uom: product.uom, warrantyText: product.warrantyText,
      highTouch: product.highTouch, priceSource: product.priceSource, highTouchSource: product.highTouchSource,
    } : emptyProduct());
    setProductModalOpen(true);
  };

  const saveProduct = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/products", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsertProduct", ...productDraft }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể lưu sản phẩm.");
      clearProductSuggestionCache();
      setProductModalOpen(false);
      setNotice("Đã cập nhật sản phẩm.");
      window.setTimeout(() => setNotice(""), 2800);
      setProductRefresh((value) => value + 1);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể lưu sản phẩm.");
    } finally {
      setSaving(false);
    }
  };

  const savePricing = async (input: PricingSettingsInput) => {
    setPricingLoading(true);
    setError("");
    try {
      const response = await fetch("/api/pricing", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const result = await response.json() as PricingSettings & { error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể lưu cách tính giá.");
      clearProductSuggestionCache();
      setPricing(result);
      setProductRefresh((value) => value + 1);
      setNotice("Đã áp dụng cách tính giá USD mới.");
      window.setTimeout(() => setNotice(""), 3000);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể lưu cách tính giá.");
    } finally {
      setPricingLoading(false);
    }
  };

  const refreshPricing = async () => {
    setPricingLoading(true);
    setError("");
    try {
      const response = await fetch("/api/pricing", { cache: "no-store" });
      const result = await response.json() as PricingSettings & { error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể làm mới tỷ giá.");
      clearProductSuggestionCache();
      setPricing(result);
      setProductRefresh((value) => value + 1);
      setNotice("Đã kiểm tra tỷ giá bán USD mới nhất.");
      window.setTimeout(() => setNotice(""), 3000);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Không thể làm mới tỷ giá.");
    } finally {
      setPricingLoading(false);
    }
  };

  const importProductFile = async (kind: "price" | "highTouch", file: File) => {
    setSaving(true);
    setError("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = kind === "price" ? parsePriceListXlsx(bytes) : parseHighTouchXlsx(bytes);
      const response = await fetch("/api/products", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: kind === "price" ? "importPriceList" : "importHighTouch",
          source: kind === "price" && "sheetName" in parsed ? `${file.name} — ${parsed.sheetName}` : file.name,
          rows: parsed.rows,
        }),
      });
      const result = await response.json() as { updated?: number; matched?: number; added?: number; total?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể nhập file.");
      clearProductSuggestionCache();
      setNotice(kind === "highTouch"
        ? `High‑Touch: đối chiếu ${result.matched ?? 0} Model, thêm ${result.added ?? 0} Model mới; tổng ${result.total ?? result.updated ?? parsed.rows.length} Model cần Logcard.`
        : `Đã cập nhật ${result.updated ?? parsed.rows.length} dòng từ ${file.name}.`);
      window.setTimeout(() => setNotice(""), 3500);
      setProductRefresh((value) => value + 1);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Không thể đọc file Excel.");
    } finally {
      setSaving(false);
    }
  };

  const importQuotationFile = async (file: File) => {
    setSaving(true);
    setError("");
    try {
      const parsed = parseQuotationWorkbookXlsx(new Uint8Array(await file.arrayBuffer()));
      const response = await fetch("/api/crm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "importQuotations", sourceFile: file.name, quotations: parsed.quotations }),
      });
      const result = await response.json() as CrmData & {
        importSummary?: { inserted: number; updated: number; total: number };
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "Không thể nhập báo giá từ Excel.");
      setData(result);
      const summary = result.importSummary;
      setNotice(`Đã đọc ${parsed.sheetCount} sheet: thêm ${summary?.inserted ?? 0}, cập nhật ${summary?.updated ?? 0} báo giá.`);
      window.setTimeout(() => setNotice(""), 4200);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Không thể đọc file báo giá Excel.");
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const moveToQuotation = submitter?.value === "save-quote";
    const result = await mutate(
      { action: draft.id ? "update" : "create", ...draft, productApplication: formatOpportunityProductLines(draft.productLines) },
      moveToQuotation ? "Đã lưu cơ hội. Đang mở báo giá mới." : draft.id ? "Đã cập nhật cơ hội." : "Đã tạo cơ hội mới.",
    );
    if (!result) return;
    const savedOpportunity = result.opportunities.find((item) => draft.id
      ? item.id === draft.id
      : item.companyName === draft.companyName && item.contactName === draft.contactName && item.productApplication === formatOpportunityProductLines(draft.productLines));
    setModalOpen(false);
    if (moveToQuotation && savedOpportunity) openQuote(savedOpportunity, undefined, draft.productLines);
  };

  const moveStage = async (opportunity: Opportunity, direction: -1 | 1) => {
    const current = PIPELINE_GROUPS.findIndex((group) => group.stages.includes(opportunity.stage));
    const next = PIPELINE_GROUPS[current + direction];
    if (next?.key === "closed") {
      setDraft({ ...fromOpportunity(opportunity), stage: "Closed Won" });
      setModalOpen(true);
      setNotice("Chọn kết quả Thành công hoặc Thất bại rồi lưu để đóng dự án.");
      window.setTimeout(() => setNotice(""), 4200);
      return;
    }
    if (next) await mutate({ action: "moveStage", id: opportunity.id, stage: next.moveTo }, `Đã chuyển sang ${next.label}.`);
  };

  const completeStep = async (opportunity: Opportunity) => {
    await mutate({ action: "completeNextStep", id: opportunity.id }, "Đã hoàn thành Next Step. Hãy lên bước tiếp theo.");
  };

  const deleteOpportunity = async (opportunity: Opportunity) => {
    const confirmed = window.confirm(
      `Xóa vĩnh viễn cơ hội "${opportunity.productApplication}" của ${opportunity.companyName}?\n\nLịch sử hoạt động của cơ hội cũng sẽ bị xóa. Cơ hội có báo giá liên kết sẽ được hệ thống bảo vệ.`,
    );
    if (!confirmed) return;
    const result = await mutate({ action: "deleteOpportunity", id: opportunity.id }, "Đã xóa cơ hội khỏi CRM.");
    if (result && draft.id === opportunity.id) setModalOpen(false);
  };

  const deleteQuotation = async (quotation: Quotation) => {
    const revenueNote = quotation.status === "Accepted"
      ? " Báo giá đang được ghi nhận doanh số; doanh số liên quan cũng sẽ được loại khỏi báo cáo."
      : "";
    const confirmed = window.confirm(
      `Xóa vĩnh viễn báo giá ${quotation.quotationNo}?${revenueNote}\n\nCơ hội CRM liên quan vẫn được giữ lại.`,
    );
    if (!confirmed) return;
    const result = await mutate({ action: "deleteQuotation", id: quotation.id }, `Đã xóa báo giá ${quotation.quotationNo}.`);
    if (result && quoteDraft?.id === quotation.id) {
      setQuoteModalOpen(false);
      setQuoteDraft(null);
    }
  };

  const downloadQuotation = async (quotation: Quotation) => {
    setSaving(true);
    setError("");
    try {
      const templateResponse = await fetch("/quotation-template.xlsx");
      if (!templateResponse.ok) throw new Error("Không thể mở mẫu báo giá Loriot.");
      const bytes = generateQuotationXlsx(new Uint8Array(await templateResponse.arrayBuffer()), quotation);
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${quotation.quotationNo.replace(/[^A-Za-z0-9_.-]/g, "-") || "Loriot-Quotation"}.xlsx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setNotice("Đã tạo file Excel theo mẫu Loriot.");
      window.setTimeout(() => setNotice(""), 2800);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Không thể xuất báo giá.");
    } finally {
      setSaving(false);
    }
  };

  const saveQuote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!quoteDraft) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const exportAfterSave = submitter?.value === "save-export";
    const result = await mutate(
      { action: "saveQuotation", ...quoteDraft },
      exportAfterSave ? "Đã lưu báo giá và chuẩn bị file Excel." : "Đã lưu báo giá và cập nhật Pipeline.",
    );
    if (!result) return;
    const saved = result.quotations.find((quote) => quote.id === quoteDraft.id || quote.quotationNo === quoteDraft.quotationNo);
    if (saved) {
      setQuoteModalOpen(false);
      setQuoteDraft(null);
      if (exportAfterSave) await downloadQuotation(saved);
    }
  };

  const navItems: { id: View; label: string; icon: IconName; count?: number }[] = [
    { id: "dashboard", label: "Tổng quan", icon: "grid" },
    { id: "leads", label: "Lead & Email", icon: "mail", count: data?.leads.filter((lead) => lead.status === "Có phản hồi").length },
    { id: "actions", label: "Việc cần làm", icon: "check", count: overdueCount },
    { id: "pipeline", label: "Pipeline", icon: "pipeline" },
    { id: "records", label: "Danh sách CRM", icon: "users" },
    { id: "quotations", label: "Báo giá", icon: "file", count: data?.quotations.length },
    { id: "sales", label: "Doanh số KH", icon: "money", count: data?.quotations.filter((quote) => quote.status === "Accepted").length },
    { id: "products", label: "Sản phẩm & Logcard", icon: "box" },
    { id: "inventory", label: "Tồn kho", icon: "box" },
    { id: "weekly", label: "Báo cáo tuần", icon: "check" },
  ];

  if (!data && !error) return <LoadingScreen />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">L</div><div><strong>LORIOT</strong><span>FLUKE CRM</span></div></div>
      <div className="workspace-label">KHÔNG GIAN LÀM VIỆC</div>
      <nav>{navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.count ? <b>{item.count}</b> : null}</button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="sales-system"><div className="system-dot"/><div><strong>Hệ thống đang hoạt động</strong><span>Dữ liệu được lưu tự động</span></div></div>
      <div className="profile"><div className="avatar">MT</div><div><strong>Mai Trần Thành</strong><span>Vàng Anh / Loriot</span></div><Icon name="chevron" size={16}/></div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="mobile-brand"><div className="brand-mark">L</div><strong>LORIOT CRM</strong></div>
        <div className="global-search"><Icon name="search" size={18}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm công ty, liên hệ, sản phẩm..." onFocus={() => setView("records")}/><kbd>⌘ K</kbd></div>
        <div className="notification-center" ref={notificationRef}>
          <button
            className={`icon-button notification ${notificationOpen ? "active" : ""}`}
            aria-label={`Thông báo${overdueCount > 0 ? `, ${overdueCount} việc cần xử lý` : ""}`}
            aria-haspopup="dialog"
            aria-expanded={notificationOpen}
            onClick={() => setNotificationOpen((value) => !value)}
          >
            <Icon name="bell" size={19}/>
            {overdueCount > 0 && <b>{overdueCount > 99 ? "99+" : overdueCount}</b>}
          </button>
          {notificationOpen && <section className="notification-panel" role="dialog" aria-label="Việc cần xử lý">
            <header className="notification-panel-header">
              <div><span>TRUNG TÂM NHẮC VIỆC</span><strong>Cần xử lý</strong></div>
              <button className="notification-panel-close" aria-label="Đóng thông báo" onClick={() => setNotificationOpen(false)}><Icon name="close" size={17}/></button>
            </header>
            {urgentNotifications.length > 0 ? <div className="notification-list">
              {urgentNotifications.slice(0, 6).map((item) => <button
                className="notification-item"
                key={item.id}
                onClick={() => { setNotificationOpen(false); openEdit(item); }}
              >
                <div className="notification-item-top"><Priority value={item.priority}/><span>{shortDate(item.nextStepDue)}</span></div>
                <strong>{item.companyName}</strong>
                <p>{item.nextStep || "Chưa có Next Step"}</p>
                <small>{item.productApplication || item.id}</small>
              </button>)}
            </div> : <div className="notification-empty"><Icon name="check" size={24}/><strong>Không có việc khẩn cấp</strong><p>Bạn không có Next Step quá hạn hoặc đến hạn hôm nay.</p></div>}
            <button className="notification-footer" onClick={() => { setView("actions"); setNotificationOpen(false); }}>
              Xem tất cả việc cần làm <Icon name="arrow" size={15}/>
            </button>
          </section>}
        </div>
        <button className="primary-button" onClick={openCreate}><Icon name="plus" size={18}/>Thêm cơ hội</button>
      </header>

      {error && <div className="error-banner"><span>{error}</span><button onClick={() => { setError(""); void load(); }}><Icon name="refresh" size={16}/>Thử lại</button></div>}
      {notice && <div className="toast"><Icon name="check" size={17}/>{notice}</div>}

      <div className="content">
        {view === "dashboard" && <Dashboard
          opportunities={opportunities}
          openOpportunities={openOpportunities}
          activeValue={activeValue}
          weightedValue={weightedValue}
          hotCount={hotCount}
          overdueCount={overdueCount}
          wonValue={wonValue}
          winRate={winRate}
          onOpen={openEdit}
          onGoActions={() => setView("actions")}
          onGoPipeline={() => setView("pipeline")}
        />}
        {view === "leads" && <LeadView
          leads={data?.leads ?? []}
          saving={saving}
          onSave={saveLead}
          onDelete={deleteLead}
          onConvert={convertLead}
          onRefresh={load}
        />}
        {view === "actions" && <ActionCenter items={actionItems} onOpen={openEdit} onComplete={completeStep} saving={saving}/>} 
        {view === "pipeline" && <Pipeline opportunities={opportunities} onOpen={openEdit} onMove={moveStage} saving={saving}/>} 
        {view === "records" && <Records
          items={filtered} search={search} setSearch={setSearch} stageFilter={stageFilter} setStageFilter={setStageFilter}
          temperatureFilter={temperatureFilter} setTemperatureFilter={setTemperatureFilter} typeFilter={typeFilter}
          setTypeFilter={setTypeFilter} onOpen={openEdit} onCreate={openCreate} onQuote={(item) => openQuote(item)}
          onDelete={deleteOpportunity} saving={saving}
        />}
        {view === "quotations" && <QuotationsView
          quotations={data?.quotations ?? []}
          opportunities={opportunities}
          onCreate={(item) => openQuote(item)}
          onEdit={(quote) => {
            const opportunity = opportunities.find((item) => item.id === quote.opportunityId);
            if (opportunity) openQuote(opportunity, quote);
          }}
          onDownload={downloadQuotation}
          onDelete={deleteQuotation}
          onImport={importQuotationFile}
          saving={saving}
        />}
        {view === "sales" && <CustomerSalesView quotations={data?.quotations ?? []} opportunities={opportunities}/>}
        {view === "products" && <ProductsView
          products={products} total={productTotal} search={productSearch} setSearch={setProductSearch}
          highTouchOnly={highTouchOnly} setHighTouchOnly={setHighTouchOnly} loading={productLoading}
          saving={saving} onOpen={openProduct} onImport={importProductFile}
          pricing={pricing} pricingLoading={pricingLoading} onSavePricing={savePricing} onRefreshPricing={refreshPricing}
        />}
        {view === "inventory" && <InventoryView
          onError={setError}
          onNotice={(message) => { setNotice(message); window.setTimeout(() => setNotice(""), 4200); }}
        />}
        {view === "weekly" && <WeeklyReportsView
          opportunities={opportunities}
          activities={data?.activities ?? []}
          onError={setError}
          onNotice={(message) => { setNotice(message); window.setTimeout(() => setNotice(""), 4200); }}
        />}
      </div>
    </main>

    <nav className="mobile-nav">{navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon name={item.icon} size={19}/><span>{item.label}</span></button>)}</nav>

    {modalOpen && <OpportunityModal
      draft={draft}
      setDraft={setDraft}
      accounts={data?.accounts ?? []}
      contacts={data?.contacts ?? []}
      pricing={pricing}
      activities={data?.activities ?? []}
      onSaveActivity={saveActivity}
      onDeleteActivity={deleteActivity}
      onClose={() => setModalOpen(false)}
      onSubmit={saveDraft}
      saving={saving}
    />}
    {quoteModalOpen && quoteDraft && <QuotationModal
      draft={quoteDraft}
      setDraft={setQuoteDraft}
      quotations={data?.quotations ?? []}
      opportunity={opportunities.find((item) => item.id === quoteDraft.opportunityId)}
      pricing={pricing}
      onClose={() => { setQuoteModalOpen(false); setQuoteDraft(null); }}
      onSubmit={saveQuote}
      saving={saving}
    />}
    {productModalOpen && <ProductModal
      draft={productDraft} setDraft={setProductDraft} onClose={() => setProductModalOpen(false)}
      onSubmit={saveProduct} saving={saving} pricing={pricing}
    />}
  </div>;
}

function PageHeader({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: ReactNode }) {
  return <div className="page-header"><div><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function Dashboard({ opportunities, openOpportunities, activeValue, weightedValue, hotCount, overdueCount, wonValue, winRate, onOpen, onGoActions, onGoPipeline }: {
  opportunities: Opportunity[]; openOpportunities: Opportunity[]; activeValue: number; weightedValue: number; hotCount: number; overdueCount: number; wonValue: number; winRate: number; onOpen: (item: Opportunity) => void; onGoActions: () => void; onGoPipeline: () => void;
}) {
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const stageRows = PIPELINE_GROUPS.map((group) => {
    const items = opportunities.filter((item) => group.stages.includes(item.stage));
    return { name: group.label, count: items.length, value: items.reduce((sum, item) => sum + item.estimatedValue, 0) };
  }).filter((row) => row.count > 0);
  const maxStageValue = Math.max(...stageRows.map((row) => row.value), 1);
  const target = 1_000_000_000;
  const targetProgress = Math.min(100, Math.round((wonValue / target) * 100));
  const temperatureCounts = {
    Hot: openOpportunities.filter((item) => item.temperature === "Hot").length,
    Warm: openOpportunities.filter((item) => item.temperature === "Warm").length,
    Cold: openOpportunities.filter((item) => item.temperature === "Cold").length,
  };
  const totalTemperature = Math.max(openOpportunities.length, 1);
  const hotDeg = temperatureCounts.Hot / totalTemperature * 360;
  const warmDeg = temperatureCounts.Warm / totalTemperature * 360 + hotDeg;
  const topDeals = [...openOpportunities].sort((a, b) => b.score - a.score || b.estimatedValue - a.estimatedValue).slice(0, 5);
  const todayLabel = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Ho_Chi_Minh",
  }).format(currentTime);

  return <>
    <PageHeader eyebrow="TỔNG QUAN SALES" title={`${vietnamGreeting(currentTime)}, Mai Trần Thành`} text="Tập trung vào đúng cơ hội, đúng người và đúng bước tiếp theo." action={<div className="today-box"><span>Hôm nay</span><strong>{todayLabel}</strong></div>}/>
    <section className="metrics-grid">
      <MetricCard label="Pipeline đang mở" value={compactMoney(activeValue)} detail={`${openOpportunities.length} cơ hội đang hoạt động`} icon="money" tone="navy"/>
      <MetricCard label="Doanh thu kỳ vọng" value={compactMoney(weightedValue)} detail="Tổng giá trị dự kiến × xác suất từng giai đoạn" icon="target" tone="blue"/>
      <MetricCard label="Cơ hội Hot" value={String(hotCount)} detail="Điểm Lead Score từ 75" icon="fire" tone="red"/>
      <MetricCard label="Cần xử lý ngay" value={String(overdueCount)} detail="Quá hạn hoặc đến hạn hôm nay" icon="clock" tone="amber"/>
    </section>
    <section className="dashboard-grid">
      <article className="panel pipeline-overview">
        <div className="panel-header"><div><span>PIPELINE</span><h2>Giá trị theo giai đoạn</h2></div><button className="text-button" onClick={onGoPipeline}>Xem pipeline <Icon name="arrow" size={16}/></button></div>
        <div className="stage-bars">{stageRows.map((row) => <div className="stage-bar-row" key={row.name}><div className="stage-name"><strong>{row.name}</strong><span>{row.count} deal</span></div><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(8, row.value / maxStageValue * 100)}%` }}/></div><b>{compactMoney(row.value)}</b></div>)}</div>
      </article>
      <article className="panel target-panel">
        <div className="panel-header"><div><span>THÁNG 08</span><h2>Mục tiêu doanh thu</h2></div><div className="target-percent">{targetProgress}%</div></div>
        <div className="target-value"><strong>{compactMoney(wonValue)}</strong><span>/ {compactMoney(target)}</span></div>
        <div className="target-track"><span style={{ width: `${targetProgress}%` }}/></div>
        <div className="target-stats"><div><span>Đã thắng</span><strong>{opportunities.filter((item) => item.status === "Won").length} deal</strong></div><div><span>Win rate</span><strong>{Math.round(winRate * 100)}%</strong></div><div><span>Còn thiếu</span><strong>{compactMoney(Math.max(0, target - wonValue))}</strong></div></div>
      </article>
    </section>
    <section className="dashboard-grid lower-grid">
      <article className="panel top-deals-panel">
        <div className="panel-header"><div><span>ƯU TIÊN</span><h2>Cơ hội nên tập trung</h2></div><button className="text-button" onClick={onGoActions}>Việc cần làm <Icon name="arrow" size={16}/></button></div>
        <div className="deal-list">{topDeals.map((deal) => <button className="deal-row" key={deal.id} onClick={() => onOpen(deal)}><div className="score-box">{deal.score}</div><div className="deal-main"><strong>{deal.companyName}</strong><span>{deal.productApplication}</span></div><div className="deal-meta"><Temperature value={deal.temperature}/><strong>{compactMoney(deal.estimatedValue)}</strong></div><Icon name="chevron" size={17}/></button>)}</div>
      </article>
      <article className="panel temperature-panel">
        <div className="panel-header"><div><span>CHẤT LƯỢNG LEAD</span><h2>Hot / Warm / Cold</h2></div></div>
        <div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(#e5484d 0 ${hotDeg}deg, #f4a524 ${hotDeg}deg ${warmDeg}deg, #2e6bd9 ${warmDeg}deg 360deg)` }}><div><strong>{openOpportunities.length}</strong><span>deal mở</span></div></div><div className="legend"><div><span className="legend-dot hot"/><span>Hot</span><strong>{temperatureCounts.Hot}</strong></div><div><span className="legend-dot warm"/><span>Warm</span><strong>{temperatureCounts.Warm}</strong></div><div><span className="legend-dot cold"/><span>Cold</span><strong>{temperatureCounts.Cold}</strong></div></div></div>
      </article>
    </section>
  </>;
}

function CustomerSalesView({ quotations, opportunities }: { quotations: Quotation[]; opportunities: Opportunity[] }) {
  const [search, setSearch] = useState("");
  const currentYear = String(new Date().getFullYear());
  const rows = useMemo(() => {
    const opportunityById = new Map(opportunities.map((opportunity) => [opportunity.id, opportunity]));
    const grouped = new Map<string, CustomerSalesRow>();
    for (const quotation of quotations) {
      if (quotation.status !== "Accepted") continue;
      const opportunity = opportunityById.get(quotation.opportunityId);
      const fallbackName = quotation.recipientCompany || "Khách hàng chưa xác định";
      const accountId = opportunity?.accountId || `CUSTOMER-${fallbackName.toLocaleUpperCase("vi")}`;
      const current = grouped.get(accountId) ?? {
        accountId,
        companyName: opportunity?.companyName || fallbackName,
        accountType: opportunity?.accountType || "Khách hàng",
        region: opportunity?.region || "",
        cumulativeRevenue: 0,
        yearRevenue: 0,
        orderCount: 0,
        lastOrderDate: "",
        lastQuotationNo: "",
      };
      current.cumulativeRevenue += quotation.total;
      if (quotation.quoteDate.startsWith(currentYear)) current.yearRevenue += quotation.total;
      current.orderCount += 1;
      if (!current.lastOrderDate || quotation.quoteDate > current.lastOrderDate) {
        current.lastOrderDate = quotation.quoteDate;
        current.lastQuotationNo = quotation.quotationNo;
      }
      grouped.set(accountId, current);
    }
    return [...grouped.values()].sort((a, b) => b.cumulativeRevenue - a.cumulativeRevenue || a.companyName.localeCompare(b.companyName, "vi"));
  }, [currentYear, opportunities, quotations]);
  const query = search.trim().toLocaleLowerCase("vi");
  const filtered = rows.filter((row) => !query || [row.companyName, row.accountType, row.region, row.lastQuotationNo].some((value) => value.toLocaleLowerCase("vi").includes(query)));
  const cumulativeRevenue = rows.reduce((sum, row) => sum + row.cumulativeRevenue, 0);
  const yearRevenue = rows.reduce((sum, row) => sum + row.yearRevenue, 0);
  const orderCount = rows.reduce((sum, row) => sum + row.orderCount, 0);
  const repeatCustomers = rows.filter((row) => row.orderCount >= 2).length;

  return <>
    <PageHeader eyebrow="CUSTOMER REVENUE" title="Doanh số cộng dồn theo khách hàng" text="Tự động cộng theo hồ sơ khách hàng ngay khi báo giá được chuyển sang trạng thái Accepted."/>
    <section className="metrics-grid customer-sales-metrics">
      <MetricCard label="Doanh số cộng dồn" value={compactMoney(cumulativeRevenue)} detail="Tất cả báo giá Accepted" icon="money" tone="navy"/>
      <MetricCard label={`Doanh số ${currentYear}`} value={compactMoney(yearRevenue)} detail="Theo ngày trên báo giá" icon="target" tone="blue"/>
      <MetricCard label="Đơn hàng ghi nhận" value={String(orderCount)} detail="Mỗi báo giá Accepted = 1 đơn" icon="file" tone="amber"/>
      <MetricCard label="Khách mua lặp lại" value={String(repeatCustomers)} detail="Có từ 2 đơn Accepted" icon="users" tone="green"/>
    </section>
    <section className="panel sales-recognition-rule"><Icon name="check" size={17}/><div><strong>Quy tắc ghi nhận doanh số</strong><span>Accepted: cộng doanh số · Draft/Sent/Expired: chưa cộng · đổi khỏi Accepted: tự loại khỏi tổng.</span></div></section>
    <div className="filter-bar"><label className="filter-search"><Icon name="search" size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm khách hàng, khu vực hoặc số báo giá..."/></label><span className="result-count">{filtered.length} khách hàng có doanh số</span></div>
    <section className="panel records-panel customer-sales-panel">{filtered.length === 0 ? <EmptyState title="Chưa có doanh số được ghi nhận" text="Chuyển báo giá đã được khách xác nhận sang Accepted để hệ thống tự cộng doanh số."/> : <div className="table-scroll"><table><thead><tr><th>Khách hàng</th><th>Doanh số cộng dồn</th><th>Doanh số năm {currentYear}</th><th>Số đơn</th><th>Giá trị trung bình</th><th>Lần mua gần nhất</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.accountId}><td><div className="company-cell"><div className="company-avatar">{row.companyName.slice(0, 1).toLocaleUpperCase("vi")}</div><div><strong>{row.companyName}</strong><span>{row.accountType}{row.region ? ` · ${row.region}` : ""}</span></div></div></td><td><strong className="sales-total-value">{money(row.cumulativeRevenue)}</strong></td><td><strong>{money(row.yearRevenue)}</strong></td><td><strong>{row.orderCount}</strong><span>{row.orderCount >= 2 ? "Khách mua lặp lại" : "Đơn đầu tiên"}</span></td><td><strong>{money(Math.round(row.cumulativeRevenue / row.orderCount))}</strong></td><td><strong>{shortDate(row.lastOrderDate)}</strong><span>{row.lastQuotationNo}</span></td></tr>)}</tbody></table></div>}</section>
  </>;
}

function ActionCenter({ items, onOpen, onComplete, saving }: { items: Opportunity[]; onOpen: (item: Opportunity) => void; onComplete: (item: Opportunity) => void; saving: boolean }) {
  const urgent = items.filter((item) => ["Quá hạn", "Hôm nay"].includes(item.priority)).length;
  return <>
    <PageHeader eyebrow="ACTION CENTER" title="Việc cần làm" text="Danh sách được tự động sắp xếp theo hạn xử lý và chất lượng cơ hội." action={<div className="action-summary"><strong>{urgent}</strong><span>việc cần xử lý ngay</span></div>}/>
    <div className="action-toolbar"><div className="action-rule"><Icon name="target" size={18}/><span>Ưu tiên: Quá hạn → Hôm nay → Sắp đến hạn → Thiếu Next Step → Lead Score cao</span></div></div>
    <section className="panel action-panel">
      <div className="action-table-head"><span>STT</span><span>Ưu tiên</span><span>Khách hàng & cơ hội</span><span>Next Step</span><span>Hạn xử lý</span><span>Giá trị</span><span /></div>
      {items.length === 0 ? <EmptyState title="Không còn việc tồn" text="Bạn đã xử lý hết các Next Step đang mở."/> : items.map((item, index) => <div className="action-row" key={item.id}>
        <b className="stt-cell">{index + 1}</b>
        <div><Priority value={item.priority}/><Temperature value={item.temperature} score={item.score}/></div>
        <button className="action-company" onClick={() => onOpen(item)}><strong>{item.companyName}</strong><span>{item.productApplication}</span><small>{stageDisplayLabel(item.stage)}</small></button>
        <div className="next-step-cell"><strong>{item.nextStep || "Chưa có bước tiếp theo"}</strong><span>{item.contactName} · {item.preferredChannel || "Chưa chọn kênh"}</span></div>
        <div className="due-cell"><Icon name="clock" size={16}/><span>{shortDate(item.nextStepDue)}</span></div>
        <strong className="value-cell">{compactMoney(item.estimatedValue)}</strong>
        <div className="row-actions"><button className="secondary-button" onClick={() => onOpen(item)}><Icon name="edit" size={15}/>Cập nhật</button><button className="complete-button" disabled={saving || !item.nextStep} onClick={() => onComplete(item)}><Icon name="check" size={16}/>Hoàn thành</button></div>
      </div>)}
    </section>
  </>;
}

function Pipeline({ opportunities, onOpen, onMove, saving }: { opportunities: Opportunity[]; onOpen: (item: Opportunity) => void; onMove: (item: Opportunity, direction: -1 | 1) => void; saving: boolean }) {
  return <>
    <PageHeader eyebrow="PIPELINE" title="Luồng cơ hội" text="6 giai đoạn bán hàng rõ ràng, từ tiếp cận đến đóng dự án." action={<div className="pipeline-total"><span>Tổng pipeline mở</span><strong>{compactMoney(opportunities.filter((item) => item.status === "Open").reduce((sum, item) => sum + item.estimatedValue, 0))}</strong></div>}/>
    <div className="pipeline-guide"><Icon name="pipeline" size={17}/><span>Dùng nút mũi tên để chuyển giai đoạn. Khi đóng dự án, hãy mở thẻ để chọn rõ <strong>Thành công</strong> hoặc <strong>Thất bại</strong>.</span></div>
    <div className="pipeline-board">{PIPELINE_GROUPS.map((column, columnIndex) => {
      const cards = opportunities.filter((item) => column.stages.includes(item.stage));
      const value = cards.reduce((sum, item) => sum + item.estimatedValue, 0);
      return <section className="pipeline-column" key={column.key}>
        <header><div><span className={`stage-dot pipeline-${column.key}`}/><strong>{column.label}</strong><b>{cards.length}</b></div><p>{column.description}</p><span>{compactMoney(value)}</span></header>
        <div className="pipeline-cards">{cards.length === 0 ? <div className="empty-column">Chưa có deal</div> : cards.map((card) => <article className="pipeline-card" key={card.id}>
          <button className="card-main" onClick={() => onOpen(card)}><div className="card-top"><Temperature value={card.temperature}/><span className="card-score">{card.score}</span></div><strong>{card.companyName}</strong><span className="pipeline-stage-detail">{stageDisplayLabel(card.stage)}</span><p>{card.productApplication}</p><div className="card-value">{money(card.estimatedValue)}</div><div className="card-detail"><Icon name="person" size={14}/><span>{card.contactName}</span></div><div className="card-detail"><Icon name="clock" size={14}/><span>{card.nextStepDue ? shortDate(card.nextStepDue) : card.status === "Open" ? "Thiếu Next Step" : "Đã đóng dự án"}</span></div></button>
          <footer><button aria-label="Lùi nhóm" disabled={saving || columnIndex === 0} onClick={() => onMove(card, -1)}>‹</button><span>Chuyển nhóm</span><button aria-label="Tiến nhóm" disabled={saving || columnIndex === PIPELINE_GROUPS.length - 1} onClick={() => onMove(card, 1)}>›</button></footer>
        </article>)}</div>
      </section>;
    })}</div>
  </>;
}

function Records({ items, search, setSearch, stageFilter, setStageFilter, temperatureFilter, setTemperatureFilter, typeFilter, setTypeFilter, onOpen, onCreate, onQuote, onDelete, saving }: {
  items: Opportunity[]; search: string; setSearch: (value: string) => void; stageFilter: string; setStageFilter: (value: string) => void; temperatureFilter: string; setTemperatureFilter: (value: string) => void; typeFilter: string; setTypeFilter: (value: string) => void; onOpen: (item: Opportunity) => void; onCreate: () => void; onQuote: (item: Opportunity) => void; onDelete: (item: Opportunity) => void; saving: boolean;
}) {
  return <>
    <PageHeader eyebrow="CRM RECORDS" title="Danh sách cơ hội" text="Một nơi duy nhất để quản lý Account, Contact, Opportunity và Next Step." action={<button className="primary-button page-button" onClick={onCreate}><Icon name="plus" size={18}/>Thêm cơ hội</button>}/>
    <div className="filter-bar"><label className="filter-search"><Icon name="search" size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm trong CRM..."/></label><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="Tất cả giai đoạn">Tất cả giai đoạn</option>{PIPELINE_GROUPS.map((group) => <option value={group.key} key={group.key}>{group.label}</option>)}</select><select value={temperatureFilter} onChange={(event) => setTemperatureFilter(event.target.value)}><option>Tất cả nhiệt độ</option><option>Hot</option><option>Warm</option><option>Cold</option></select><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>Tất cả loại khách</option>{ACCOUNT_TYPES.map((type) => <option key={type}>{type}</option>)}</select><div className="result-count">{items.length} kết quả</div></div>
    <section className="panel records-panel">
      <div className="table-scroll"><table><thead><tr><th className="stt-column">STT</th><th>Trading Partner / Khách hàng</th><th>Liên hệ</th><th>Cơ hội / End-User</th><th>Giai đoạn</th><th>Điểm</th><th>Giá trị</th><th>Next Step</th><th /></tr></thead><tbody>{items.map((item, index) => <tr key={item.id} onClick={() => onOpen(item)}><td className="stt-cell">{index + 1}</td><td><div className="company-cell"><div className="company-avatar">{item.companyName.slice(0, 1)}</div><div><strong>{item.companyName}</strong><span>{item.customerCode ? `Mã ${item.customerCode} · ` : ""}{item.accountType} · {item.region}</span></div></div></td><td><strong>{item.contactName}</strong><span>{item.title || item.department}</span></td><td><strong>{item.productApplication}</strong><span>{item.endUserCompany ? `End-User: ${item.endUserCompany}` : item.id}</span></td><td><span className="stage-pill">{stageDisplayLabel(item.stage)}</span></td><td><Temperature value={item.temperature} score={item.score}/></td><td><strong>{compactMoney(item.estimatedValue)}</strong><span>kỳ vọng {compactMoney(item.weightedValue)}</span></td><td><strong>{item.nextStep || "Chưa có"}</strong><span>{shortDate(item.nextStepDue)}</span></td><td><div className="table-actions"><button className="table-quote" aria-label="Tạo báo giá" title="Tạo báo giá" onClick={(event) => { event.stopPropagation(); onQuote(item); }}><Icon name="file" size={16}/></button><button className="table-edit" aria-label="Sửa" title="Sửa"><Icon name="edit" size={16}/></button><button className="table-delete" aria-label="Xóa cơ hội" title="Xóa cơ hội" disabled={saving} onClick={(event) => { event.stopPropagation(); onDelete(item); }}><Icon name="trash" size={15}/></button></div></td></tr>)}</tbody></table></div>
      {items.length === 0 && <EmptyState title="Không tìm thấy cơ hội" text="Thử thay đổi bộ lọc hoặc tạo một cơ hội mới."/>}
    </section>
  </>;
}

function OpportunitySearchPicker({ opportunities, selectedId, onSelect }: {
  opportunities: Opportunity[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const selected = opportunities.find((item) => item.id === selectedId);
  const normalizedQuery = normalizeSearchText(query);
  const searchIndex = useMemo(() => opportunities.map((item) => ({
    item,
    text: normalizeSearchText([
      item.customerCode,
      item.companyName,
      item.contactName,
      item.endUserCompany,
      item.endUserContactName,
      item.productApplication,
      item.id,
    ].join(" ")),
  })), [opportunities]);
  const matches = useMemo(() => {
    if (!normalizedQuery) return [];
    return searchIndex.filter(({ text }) => text.includes(normalizedQuery)).slice(0, 8).map(({ item }) => item);
  }, [normalizedQuery, searchIndex]);
  useEffect(() => {
    if (!selectedId && !focused) setQuery("");
  }, [focused, selectedId]);
  const choose = (opportunity: Opportunity) => {
    onSelect(opportunity.id);
    setQuery(opportunitySearchLabel(opportunity));
    setOpen(false);
  };
  return <div className="opportunity-search-picker">
    <Icon name="search" size={16}/>
    <input
      role="combobox"
      aria-label="Tìm mã khách hàng hoặc cơ hội"
      aria-autocomplete="list"
      aria-expanded={open && Boolean(normalizedQuery)}
      value={query}
      placeholder={opportunities.length === 0 ? "Không có cơ hội đang mở" : "Gõ mã khách hàng, tên công ty, End‑User hoặc Model..."}
      disabled={opportunities.length === 0}
      onFocus={(event) => { setFocused(true); setOpen(true); event.currentTarget.select(); }}
      onChange={(event) => { setQuery(event.target.value); onSelect(""); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
        if (event.key === "Enter" && open && matches[0]) { event.preventDefault(); choose(matches[0]); }
      }}
      onBlur={() => window.setTimeout(() => { setFocused(false); setOpen(false); }, 140)}
    />
    {selected && <span className="opportunity-search-selected"><Icon name="check" size={12}/>Đã chọn</span>}
    {open && normalizedQuery && <div className="opportunity-search-menu" role="listbox">
      {matches.length > 0 ? matches.map((item) => <button
        type="button"
        role="option"
        aria-selected={item.id === selectedId}
        key={item.id}
        onMouseDown={(event) => { event.preventDefault(); choose(item); }}
      >
        <span><strong>{item.customerCode ? `${item.customerCode} · ` : ""}{item.companyName}</strong><small>{item.endUserCompany ? `End‑User: ${item.endUserCompany} · ` : ""}{item.productApplication}</small></span>
        <em>{stageDisplayLabel(item.stage)}</em>
      </button>) : <div className="opportunity-search-empty">Không tìm thấy cơ hội đang mở phù hợp.</div>}
    </div>}
  </div>;
}

function QuotationsView({ quotations, opportunities, onCreate, onEdit, onDownload, onDelete, onImport, saving }: {
  quotations: Quotation[];
  opportunities: Opportunity[];
  onCreate: (opportunity: Opportunity) => void;
  onEdit: (quotation: Quotation) => void;
  onDownload: (quotation: Quotation) => void;
  onDelete: (quotation: Quotation) => void;
  onImport: (file: File) => void;
  saving: boolean;
}) {
  const importInput = useRef<HTMLInputElement>(null);
  const openOpportunities = opportunities.filter((item) => item.status === "Open");
  const [selectedId, setSelectedId] = useState("");
  const [quoteSearch, setQuoteSearch] = useState("");
  const effectiveSelectedId = openOpportunities.some((item) => item.id === selectedId)
    ? selectedId
    : "";
  const opportunityById = useMemo(() => new Map(opportunities.map((item) => [item.id, item])), [opportunities]);
  const quotationSearchIndex = useMemo(() => quotations.map((quote) => {
    const opportunity = opportunityById.get(quote.opportunityId);
    return {
      quote,
      text: normalizeSearchText([
        quote.quotationNo,
        quote.customerId,
        quote.recipientCompany,
        quote.attention,
        quote.recipientEmail,
        quote.status,
        opportunity?.companyName,
        opportunity?.endUserCompany,
        ...quote.items.flatMap((item) => [item.itemNumber, item.description]),
      ].filter(Boolean).join(" ")),
    };
  }), [opportunityById, quotations]);
  const normalizedQuoteSearch = normalizeSearchText(quoteSearch);
  const filteredQuotations = useMemo(() => {
    if (!normalizedQuoteSearch) return quotations;
    return quotationSearchIndex.filter(({ text }) => text.includes(normalizedQuoteSearch)).map(({ quote }) => quote);
  }, [normalizedQuoteSearch, quotationSearchIndex, quotations]);
  const quoteTotals = quotations.reduce((totals, quote) => {
    const currency = quote.currency.toUpperCase() === "VNĐ" ? "VND" : quote.currency.toUpperCase();
    totals.set(currency, (totals.get(currency) ?? 0) + quote.total);
    return totals;
  }, new Map<string, number>());
  const quoteTotalLabel = [...quoteTotals].map(([currency, value]) => quoteMoney(value, currency)).join(" · ") || quoteMoney(0, "VND");
  return <>
    <PageHeader eyebrow="QUOTATION CENTER" title="Báo giá Loriot" text="Tạo, lưu lịch sử và tải Excel theo đúng mẫu báo giá của công ty." action={<div className="pipeline-total"><span>Tổng giá trị theo tiền tệ</span><strong>{quoteTotalLabel}</strong></div>}/>
    <section className="quote-create-panel panel">
      <div><div className="quote-create-icon"><Icon name="file" size={22}/></div><div><strong>Tạo báo giá mới</strong><span>Chọn đúng mã khách hàng/cơ hội; form luôn mở mới và chỉ điền dữ liệu của lựa chọn này.</span></div></div>
      <div className="quote-create-actions">
        <input ref={importInput} hidden type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.currentTarget.value = ""; }}/>
        <OpportunitySearchPicker opportunities={openOpportunities} selectedId={effectiveSelectedId} onSelect={setSelectedId}/>
        <button className="secondary-button" disabled={saving} onClick={() => importInput.current?.click()}><Icon name="upload" size={16}/>Nhập Excel nhiều sheet</button>
        <button className="primary-button" disabled={!effectiveSelectedId} title={!effectiveSelectedId ? "Hãy chọn mã khách hàng/cơ hội trước" : "Mở báo giá mới"} onClick={() => { const item = opportunities.find((opportunity) => opportunity.id === effectiveSelectedId); if (item) { onCreate(item); setSelectedId(""); } }}><Icon name="plus" size={17}/>{effectiveSelectedId ? "Tạo báo giá" : "Chọn cơ hội trước"}</button>
        <div className={`quote-selection-note ${effectiveSelectedId ? "ready" : ""}`}><Icon name={effectiveSelectedId ? "check" : "file"} size={14}/><span>{effectiveSelectedId ? "Đã chọn đúng cơ hội. Bạn có thể tạo báo giá mới." : "Gõ mã khách hàng, tên công ty, End‑User hoặc Model để tìm nhanh một cơ hội CRM đang mở."}</span></div>
      </div>
    </section>
    <p className="catalog-footnote">Mỗi sheet được đọc thành một báo giá. Nếu số báo giá đã tồn tại, hệ thống cập nhật báo giá đó để không tạo bản trùng.</p>
    <div className="filter-bar quotation-filter"><label className="filter-search"><Icon name="search" size={17}/><input value={quoteSearch} onChange={(event) => setQuoteSearch(event.target.value)} placeholder="Gõ số báo giá, khách hàng, End-User hoặc Model..."/></label><span className="result-count">{filteredQuotations.length} kết quả</span></div>
    <section className="panel quotes-panel">
      <div className="panel-header"><div><span>LỊCH SỬ</span><h2>{filteredQuotations.length} / {quotations.length} báo giá</h2></div></div>
      {filteredQuotations.length === 0 ? <EmptyState title={quotations.length === 0 ? "Chưa có báo giá" : "Không tìm thấy báo giá"} text={quotations.length === 0 ? "Chọn một cơ hội ở phía trên để tạo báo giá đầu tiên." : "Thử gõ một phần số báo giá, khách hàng hoặc Model."}/> : <div className="table-scroll"><table><thead><tr><th className="stt-column">STT</th><th>Số báo giá</th><th>Khách nhận báo giá</th><th>End-User nội bộ</th><th>Ngày / Trạng thái</th><th>Sản phẩm</th><th>Tổng cộng</th><th /></tr></thead><tbody>{filteredQuotations.map((quote, index) => {
        const opportunity = opportunityById.get(quote.opportunityId);
        return <tr key={quote.id}><td className="stt-cell">{index + 1}</td><td><strong>{quote.quotationNo}</strong><span>{quote.customerId || quote.id}</span></td><td><strong>{quote.recipientCompany}</strong><span>{quote.attention}{quote.recipientEmail ? ` · ${quote.recipientEmail}` : ""}</span></td><td><strong>{opportunity?.endUserCompany || "—"}</strong><span>{opportunity?.endUserIndustry || "Thông tin dùng nội bộ"}</span></td><td><strong>{shortDate(quote.quoteDate)}</strong><span className={`quote-status status-${quote.status.toLowerCase()}`}>{quote.status}</span></td><td><strong>{quote.items.length} dòng</strong><span>{quote.items[0]?.description || "—"}</span></td><td><strong>{quoteMoney(quote.total, quote.currency)}</strong><span>VAT {quote.vatRate}% · {quote.currency}</span></td><td><div className="quote-row-actions"><button className="secondary-button" onClick={() => onEdit(quote)}><Icon name="edit" size={15}/>Sửa</button><button className="primary-button" disabled={saving} onClick={() => onDownload(quote)}><Icon name="download" size={15}/>Excel</button><button className="danger-button" disabled={saving} onClick={() => onDelete(quote)}><Icon name="trash" size={15}/>Xóa</button></div></td></tr>;
      })}</tbody></table></div>}
    </section>
  </>;
}

function ProductsView({ products, total, search, setSearch, highTouchOnly, setHighTouchOnly, loading, saving, onOpen, onImport,
  pricing, pricingLoading, onSavePricing, onRefreshPricing }: {
  products: Product[]; total: number; search: string; setSearch: (value: string) => void;
  highTouchOnly: boolean; setHighTouchOnly: (value: boolean) => void; loading: boolean; saving: boolean;
  onOpen: (product?: Product) => void; onImport: (kind: "price" | "highTouch", file: File) => void;
  pricing: PricingSettings | null; pricingLoading: boolean;
  onSavePricing: (input: PricingSettingsInput) => Promise<void>; onRefreshPricing: () => Promise<void>;
}) {
  const priceInput = useRef<HTMLInputElement>(null);
  const highTouchInput = useRef<HTMLInputElement>(null);
  return <>
    <PageHeader eyebrow="PRODUCT MASTER" title="Sản phẩm & Logcard" text="Tra Model, giá hãng, xuất xứ, bảo hành và trạng thái High‑Touch trong một nơi."
      action={<button className="primary-button page-button" onClick={() => onOpen()}><Icon name="plus" size={17}/>Thêm sản phẩm</button>}/>
    <PricingPanel key={`${pricing?.useManualRate}-${pricing?.manualRate}-${pricing?.bufferPercent}-${pricing?.roundingStep}`}
      pricing={pricing} loading={pricingLoading} onSave={onSavePricing} onRefresh={onRefreshPricing}/>
    <section className="panel catalog-guide">
      <div><Icon name="search" size={20}/><span><strong>Tra cứu nhanh</strong><small>Nhập Model hoặc Item No.; nhãn đỏ nghĩa là cần đăng ký Logcard.</small></span></div>
      <div className="catalog-import-actions">
        <input ref={priceInput} hidden type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport("price", file); event.currentTarget.value = ""; }}/>
        <input ref={highTouchInput} hidden type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport("highTouch", file); event.currentTarget.value = ""; }}/>
        <button className="secondary-button" disabled={saving} onClick={() => priceInput.current?.click()}><Icon name="upload" size={15}/>Cập nhật bảng giá</button>
        <button className="secondary-button" disabled={saving} onClick={() => highTouchInput.current?.click()}><Icon name="upload" size={15}/>Cập nhật High‑Touch</button>
      </div>
    </section>
    <div className="filter-bar catalog-filter"><label className="filter-search"><Icon name="search" size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Model, Item No. hoặc mô tả..."/></label><label className="high-touch-toggle"><input type="checkbox" checked={highTouchOnly} onChange={(event) => setHighTouchOnly(event.target.checked)}/><span>Chỉ thiết bị cần Logcard</span></label><span className="result-count">{loading ? "Đang tra..." : `${total.toLocaleString("vi-VN")} sản phẩm`}</span></div>
    <section className="panel records-panel catalog-panel">
      {loading && products.length === 0 ? <EmptyState title="Đang nạp danh mục Fluke" text="Lần mở đầu tiên có thể cần thêm vài giây để tạo thư viện sản phẩm."/> : products.length === 0 ? <EmptyState title="Không tìm thấy Model" text="Thử tìm theo một phần Model hoặc kiểm tra lại Item No."/> : <div className="table-scroll"><table><thead><tr><th>Model / Item No.</th><th>Description</th><th>Giá quy đổi từ USD</th><th>Xuất xứ / Bảo hành</th><th>Logcard</th><th>Trạng thái</th><th /></tr></thead><tbody>{products.map((product) => <tr key={product.id} onClick={() => onOpen(product)}><td><strong>{product.model}</strong><span>Item No. {product.itemNo} · {product.productFamily || "—"}</span></td><td><strong>{product.description || "Chưa có mô tả"}</strong><span>{product.marketModel || product.modelGroup || "—"}</span></td><td><strong>{product.listPriceVnd ? money(product.listPriceVnd) : "Chưa có giá USD"}</strong><span>{product.listPriceUsd ? `USD ${product.listPriceUsd.toLocaleString("en-US")} × tỷ giá đang dùng` : product.priceSource}</span></td><td><strong>{product.countryOfOrigin || "Chưa xác định"}</strong><span>Bảo hành: {product.warrantyText || "Chưa nhập"}</span></td><td>{product.highTouch ? <span className="logcard-badge logcard-required">CẦN LOGCARD</span> : <span className="logcard-badge logcard-clear">CHƯA ĐÁNH DẤU</span>}<small className="source-date">{product.highTouchSource || "Chưa có nguồn High‑Touch"}</small></td><td><span className={`product-status status-${product.itemStatus.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{product.itemStatus || "—"}</span></td><td><button className="table-edit" onClick={(event) => { event.stopPropagation(); onOpen(product); }} aria-label="Sửa sản phẩm"><Icon name="edit" size={15}/></button></td></tr>)}</tbody></table></div>}
    </section>
    <p className="catalog-footnote">Giá quy đổi = giá USD × tỷ giá đang dùng × (1 + % dự phòng), sau đó làm tròn lên. Cột giá VND trong file hãng không được dùng. Báo giá đã lưu giữ nguyên giá lịch sử; muốn áp dụng tỷ giá mới, hãy chọn lại Model. File High‑Touch được đối chiếu và cộng thêm: Model đã có được giữ nguyên, Model mới được bổ sung; muốn bỏ cờ Logcard, hãy mở sản phẩm và tắt High‑Touch thủ công.</p>
  </>;
}

function PricingPanel({ pricing, loading, onSave, onRefresh }: {
  pricing: PricingSettings | null; loading: boolean;
  onSave: (input: PricingSettingsInput) => Promise<void>; onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<PricingSettingsInput>(() => ({
    useManualRate: pricing?.useManualRate ?? false,
    manualRate: pricing?.manualRate ?? 0,
    bufferPercent: pricing?.bufferPercent ?? 0,
    roundingStep: pricing?.roundingStep ?? 1_000,
  }));
  const update = <K extends keyof PricingSettingsInput>(key: K, value: PricingSettingsInput[K]) => setDraft({ ...draft, [key]: value });
  const sampleRate = draft.useManualRate ? draft.manualRate : (pricing?.liveRate ?? 0);
  const rateAfterBuffer = Math.round(sampleRate * (1 + draft.bufferPercent / 100));
  return <section className="panel pricing-panel">
    <div className="pricing-summary">
      <div className="pricing-icon"><Icon name="money" size={21}/></div>
      <div><span>TỶ GIÁ BÁN USD · VIETCOMBANK</span><strong>{pricing?.liveRate ? `${pricing.liveRate.toLocaleString("vi-VN")} VND` : "Đang cập nhật..."}</strong><small>{pricing?.sourceUpdatedAt ? `Nguồn cập nhật: ${pricing.sourceUpdatedAt}` : "Đang dùng tỷ giá dự phòng gần nhất"}</small></div>
      <div className={`pricing-mode ${draft.useManualRate ? "manual" : "auto"}`}>{draft.useManualRate ? "NHẬP TAY" : "TỰ ĐỘNG"}</div>
    </div>
    <form className="pricing-controls" onSubmit={(event) => { event.preventDefault(); void onSave(draft); }}>
      <label><span>Cách lấy tỷ giá</span><select value={draft.useManualRate ? "manual" : "auto"} onChange={(event) => update("useManualRate", event.target.value === "manual")}><option value="auto">Tự động — Vietcombank</option><option value="manual">Nhập tỷ giá riêng</option></select></label>
      <label><span>Tỷ giá nhập tay</span><MoneyInput disabled={!draft.useManualRate} value={draft.manualRate} onChange={(value) => update("manualRate", value)} placeholder="Ví dụ 27.000"/></label>
      <label><span>Dự phòng biến động (%)</span><input type="number" min="0" max="30" step="0.1" value={draft.bufferPercent} onChange={(event) => update("bufferPercent", Number(event.target.value))}/></label>
      <label><span>Làm tròn lên</span><select value={draft.roundingStep} onChange={(event) => update("roundingStep", Number(event.target.value))}><option value={1}>1 VND</option><option value={100}>100 VND</option><option value={1000}>1.000 VND</option><option value={10000}>10.000 VND</option></select></label>
      <div className="pricing-result"><span>Tỷ giá sau dự phòng</span><strong>{rateAfterBuffer ? `${rateAfterBuffer.toLocaleString("vi-VN")} VND/USD` : "—"}</strong></div>
      <div className="pricing-actions"><button type="button" className="secondary-button" disabled={loading} onClick={() => void onRefresh()}><Icon name="refresh" size={15}/>{loading ? "Đang cập nhật..." : "Làm mới tỷ giá"}</button><button className="primary-button" disabled={loading}>Lưu cách tính</button></div>
    </form>
  </section>;
}

function ProductPicker({ value, onChange, onSelect, pricing, required = false }: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (product: Product) => void;
  pricing: PricingSettings | null;
  required?: boolean;
}) {
  const [matches, setMatches] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const pricedMatches = useMemo(() => matches.map((product) => ({
    ...product,
    listPriceVnd: pricing ? calculateVndPrice(
      product.listPriceUsd, pricing.effectiveRate, pricing.bufferPercent, pricing.roundingStep,
    ) : 0,
  })), [matches, pricing]);
  useEffect(() => {
    const query = productSuggestionKey(value);
    if (!focused) return;
    if (!query) {
      setMatches([]);
      setLoading(false);
      return;
    }
    const cached = cachedProductSuggestions(query);
    if (cached.products.length > 0) {
      setMatches(cached.products);
      setOpen(true);
    }
    if (cached.exact) {
      setLoading(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      if (cached.products.length === 0) setLoading(true);
      try {
        const products = await requestProductSuggestions(query);
        if (active) {
          setMatches(products);
          setOpen(true);
        }
      } catch {
        if (active) setMatches([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 70);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [value, focused]);
  return <div className="product-picker"><input required={required} value={value} onChange={(event) => { onChange(event.target.value); setOpen(true); }} onFocus={() => { setFocused(true); setOpen(true); }} onBlur={() => window.setTimeout(() => { setFocused(false); setOpen(false); }, 140)} placeholder="Gõ Model để xem gợi ý..."/>{loading && <span className="picker-loading">…</span>}{open && pricedMatches.length > 0 && <div className="product-picker-menu">{pricedMatches.map((product) => <button type="button" key={product.id} disabled={!pricing} onMouseDown={(event) => { event.preventDefault(); if (pricing) onSelect(product); setFocused(false); setOpen(false); }}><span><strong>{product.model}</strong><small>Item {product.itemNo} · {product.countryOfOrigin || "—"}</small></span><span><b>{pricing ? (product.listPriceVnd ? money(product.listPriceVnd) : "Chưa có giá") : "Đang lấy tỷ giá"}</b>{typeof product.stockQuantity === "number" && <i className={product.stockQuantity > 0 ? "picker-stock" : "picker-stock none"}>Tồn: {product.stockQuantity.toLocaleString("vi-VN")}</i>}{product.highTouch && <em>Cần Logcard</em>}</span></button>)}</div>}</div>;
}

function ProductModal({ draft, setDraft, onClose, onSubmit, saving, pricing }: {
  draft: ProductDraft; setDraft: (draft: ProductDraft) => void; onClose: () => void; onSubmit: (event: FormEvent) => void; saving: boolean;
  pricing: PricingSettings | null;
}) {
  const update = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setDraft({ ...draft, [key]: value });
  const convertedPrice = calculateVndPrice(
    draft.listPriceUsd, pricing?.effectiveRate ?? 0, pricing?.bufferPercent ?? 0, pricing?.roundingStep ?? 1_000,
  );
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal product-modal" role="dialog" aria-modal="true"><header className="modal-header"><div><span>{draft.id || "SẢN PHẨM MỚI"}</span><h2>{draft.id ? "Cập nhật sản phẩm" : "Thêm sản phẩm"}</h2><p>Sửa lẻ tại đây; cập nhật số lượng lớn bằng file Excel ở màn hình Sản phẩm & Logcard.</p></div><button className="modal-close" onClick={onClose}><Icon name="close"/></button></header><form onSubmit={onSubmit}><div className="modal-body"><section className="form-section"><div className="section-title"><div><Icon name="box" size={18}/></div><span><strong>Nhận diện sản phẩm</strong><small>Item No. là khóa chính để cập nhật bảng giá</small></span></div><div className="form-grid"><FormField label="Model" required><input required value={draft.model} onChange={(event) => update("model", event.target.value)}/></FormField><FormField label="Item No." required><input required value={draft.itemNo} onChange={(event) => update("itemNo", event.target.value)}/></FormField><FormField label="Market Model"><input value={draft.marketModel} onChange={(event) => update("marketModel", event.target.value)}/></FormField><FormField label="Product Family / Model Group"><div className="split-fields"><input value={draft.productFamily} onChange={(event) => update("productFamily", event.target.value)} placeholder="Family"/><input value={draft.modelGroup} onChange={(event) => update("modelGroup", event.target.value)} placeholder="Group"/></div></FormField><FormField label="Description" wide required><textarea required rows={3} value={draft.description} onChange={(event) => update("description", event.target.value)}/></FormField></div></section><section className="form-section"><div className="section-title"><div><Icon name="money" size={18}/></div><span><strong>Giá và thông tin báo giá</strong><small>Giá VND được quy đổi từ USD; không dùng cột VND trong file hãng</small></span></div><div className="form-grid"><FormField label="Giá hãng USD" required><MoneyInput required decimals={2} value={draft.listPriceUsd} onChange={(value) => update("listPriceUsd", value)} placeholder="0.00"/></FormField><FormField label="Giá VND tạm tính"><div className="converted-price"><strong>{convertedPrice ? money(convertedPrice) : "Nhập giá USD"}</strong><span>Tỷ giá {pricing?.effectiveRate.toLocaleString("vi-VN") ?? "—"} · dự phòng {pricing?.bufferPercent ?? 0}%</span></div></FormField><FormField label="Xuất xứ"><input value={draft.countryOfOrigin} onChange={(event) => update("countryOfOrigin", event.target.value.toUpperCase())} placeholder="US, CN, SG..."/></FormField><FormField label="Bảo hành"><input value={draft.warrantyText} onChange={(event) => update("warrantyText", event.target.value)} placeholder="12 tháng"/></FormField><FormField label="ĐVT"><input value={draft.uom} onChange={(event) => update("uom", event.target.value.toUpperCase())}/></FormField><FormField label="Trạng thái"><input value={draft.itemStatus} onChange={(event) => update("itemStatus", event.target.value.toUpperCase())}/></FormField><FormField label="High‑Touch / Logcard" wide><label className="check-field"><input type="checkbox" checked={draft.highTouch} onChange={(event) => update("highTouch", event.target.checked)}/><span>Thiết bị cần đăng ký Logcard với hãng</span></label></FormField></div></section></div><footer className="modal-footer"><span><b>*</b> Model, Item No. và giá USD không được để trống</span><div><button type="button" className="secondary-button modal-cancel" onClick={onClose}>Hủy</button><button className="primary-button save-button" disabled={saving}>{saving ? "Đang lưu..." : "Lưu sản phẩm"}</button></div></footer></form></div></div>;
}

function QuotationModal({ draft, setDraft, quotations, opportunity, pricing, onClose, onSubmit, saving }: {
  draft: QuoteDraft;
  setDraft: (draft: QuoteDraft | null) => void;
  quotations: Quotation[];
  opportunity?: Opportunity;
  pricing: PricingSettings | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = <K extends keyof QuoteDraft>(key: K, value: QuoteDraft[K]) => setDraft({ ...draft, [key]: value });
  const updateQuoteIdentity = (quoteDate: string, rawCustomerCode: string) => {
    const customerId = normalizeCustomerCode(rawCustomerCode);
    setDraft({
      ...draft,
      quoteDate,
      customerId,
      quotationNo: draft.id ? draft.quotationNo : quoteSequence(quoteDate, customerId, quotations),
    });
  };
  const updateItem = <K extends keyof QuoteItemDraft>(index: number, key: K, value: QuoteItemDraft[K]) => {
    const items = draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item);
    update("items", items);
  };
  const replaceItem = (index: number, item: QuoteItemDraft) => update("items", draft.items.map((current, itemIndex) => itemIndex === index ? item : current));
  const roundDraftMoney = (value: number) => draft.currency.toUpperCase() === "VND"
    ? Math.round(value)
    : Math.round(value * 100) / 100;
  const chooseProduct = (index: number, product: Product) => replaceItem(index, {
    productId: product.id,
    itemNumber: product.model,
    description: product.description,
    application: draft.items[index].application || opportunity?.productApplication || "",
    unit: product.uom || "EA",
    quantity: draft.items[index].quantity || 1,
    listPrice: product.listPriceVnd,
    discountPercent: 0,
    origin: product.countryOfOrigin,
    warranty: product.warrantyText || "12 tháng",
    unitPrice: product.listPriceVnd,
  });
  const setListPrice = (index: number, value: number) => {
    const item = draft.items[index];
    const listPrice = roundDraftMoney(value);
    replaceItem(index, { ...item, listPrice, unitPrice: roundDraftMoney(listPrice * (1 - item.discountPercent / 100)) });
  };
  const setDiscount = (index: number, value: number) => {
    const item = draft.items[index];
    const discount = Math.max(0, Math.min(100, value));
    replaceItem(index, { ...item, discountPercent: discount, unitPrice: roundDraftMoney(item.listPrice * (1 - discount / 100)) });
  };
  const setUnitPrice = (index: number, value: number) => {
    const item = draft.items[index];
    const unitPrice = Math.max(0, roundDraftMoney(value));
    const derivedDiscount = item.listPrice > 0 && unitPrice <= item.listPrice ? (1 - unitPrice / item.listPrice) * 100 : 0;
    replaceItem(index, { ...item, unitPrice, discountPercent: Math.round(Math.max(0, Math.min(100, derivedDiscount)) * 100) / 100 });
  };
  const subtotal = roundDraftMoney(draft.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const vatAmount = roundDraftMoney(subtotal * draft.vatRate / 100);
  const total = roundDraftMoney(subtotal + vatAmount);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`modal quotation-modal ${draft.id ? "is-edit" : "is-create"}`} role="dialog" aria-modal="true" aria-label={draft.id ? "Cập nhật báo giá" : "Tạo báo giá"}>
      <header className="modal-header"><div><span>{draft.quotationNo || "BÁO GIÁ MỚI"}</span><h2>{draft.id ? "Cập nhật báo giá" : "Tạo báo giá Loriot"}</h2><p>Dữ liệu sau khi lưu sẽ được xuất thành file Excel theo mẫu công ty.</p></div><button className="modal-close" onClick={onClose} aria-label="Đóng"><Icon name="close"/></button></header>
      <form onSubmit={onSubmit} autoComplete="off">
        <div className="modal-body">
          {opportunity && <div className="quote-context"><div><span>KHÁCH NHẬN BÁO GIÁ</span><strong>{opportunity.companyName}</strong><small>{opportunity.accountType}</small></div><Icon name="arrow"/><div><span>END-USER CUỐI</span><strong>{opportunity.endUserCompany || "Chưa xác định"}</strong><small>{opportunity.endUserIndustry || "Thông tin nội bộ CRM"}</small></div><p>End‑User chỉ dùng để quản lý cơ hội, không tự động in lên báo giá gửi Trading Partner.</p></div>}
          <section className="form-section"><div className="section-title"><div><Icon name="file" size={18}/></div><span><strong>Thông tin báo giá</strong><small>Header của file Excel</small></span></div><div className="form-grid quote-header-grid">
            <FormField label="Số báo giá" required hint={draft.id ? "Được khóa để giữ đúng lịch sử báo giá" : "Tự tạo theo ngày + mã khách hàng + số thứ tự"}><input required readOnly className="readonly-identity" value={draft.quotationNo}/></FormField>
            <FormField label="Mã khách hàng" required hint="Được chuyển tự động từ cơ hội CRM"><input required value={draft.customerId} onChange={(event) => updateQuoteIdentity(draft.quoteDate, event.target.value)} placeholder="Ví dụ: THBVN"/></FormField>
            <FormField label="Ngày báo giá" required><input required type="date" value={draft.quoteDate} onChange={(event) => updateQuoteIdentity(event.target.value, draft.customerId)}/></FormField>
            <FormField label="Ngày hết hạn"><input type="date" value={draft.expirationDate} onChange={(event) => update("expirationDate", event.target.value)}/></FormField>
            <FormField label="Công ty nhận báo giá" required wide><input required value={draft.recipientCompany} onChange={(event) => update("recipientCompany", event.target.value)}/></FormField>
            <FormField label="Địa chỉ" wide><input value={draft.recipientAddress} onChange={(event) => update("recipientAddress", event.target.value)}/></FormField>
            <FormField label="Người nhận / ATTN"><input value={draft.attention} onChange={(event) => update("attention", event.target.value)}/></FormField>
            <FormField label="Email"><input type="email" value={draft.recipientEmail} onChange={(event) => update("recipientEmail", event.target.value)}/></FormField>
          </div></section>
          <section className="form-section"><div className="section-title"><div><Icon name="briefcase" size={18}/></div><span><strong>Điều khoản thương mại</strong><small>Khớp các trường trong mẫu báo giá</small></span></div><div className="form-grid commercial-grid">
            <FormField label="Phương thức vận chuyển"><input value={draft.shippingMethod} onChange={(event) => update("shippingMethod", event.target.value)}/></FormField>
            <FormField label="Điều kiện giao hàng"><input value={draft.shippingTerms} onChange={(event) => update("shippingTerms", event.target.value)}/></FormField>
            <FormField label="Thời gian giao hàng"><input value={draft.deliveryDate} onChange={(event) => update("deliveryDate", event.target.value)}/></FormField>
            <FormField label="Điều khoản thanh toán"><input value={draft.paymentTerms} onChange={(event) => update("paymentTerms", event.target.value)}/></FormField>
            <FormField label="Tiền tệ"><select value={draft.currency} onChange={(event) => update("currency", event.target.value)}><option>VND</option><option>USD</option><option>EUR</option></select></FormField>
            <FormField label="VAT (%)"><input type="number" min="0" max="100" value={draft.vatRate} onChange={(event) => update("vatRate", Number(event.target.value))}/></FormField>
          </div></section>
          <section className="form-section quote-items-section"><div className="section-title"><div><Icon name="money" size={18}/></div><span><strong>Sản phẩm báo giá</strong><small>Ứng dụng tự lấy từ CRM; chọn Model sẽ điền Description, giá, xuất xứ và bảo hành</small></span><button type="button" className="secondary-button add-item-button" onClick={() => update("items", [...draft.items, { productId: "", itemNumber: "", description: "", application: opportunity?.productApplication || "", unit: "EA", quantity: 1, listPrice: 0, discountPercent: 0, origin: "", warranty: "12 tháng", unitPrice: 0 }])}><Icon name="plus" size={15}/>Thêm dòng</button></div>
            <div className="quote-items-table"><div className="quote-items-head"><span>STT</span><span>Model</span><span>Mô tả / ứng dụng / xuất xứ / bảo hành</span><span>ĐVT</span><span>SL</span><span>Giá hãng</span><span>CK %</span><span>Giá chốt</span><span>Thành tiền</span><span /></div>{draft.items.map((item, index) => <div className="quote-item-row" key={index}><b>{index + 1}</b><ProductPicker pricing={pricing} value={item.itemNumber} onChange={(value) => replaceItem(index, { ...item, itemNumber: value, productId: "" })} onSelect={(product) => chooseProduct(index, product)}/><div className="quote-description-fields"><textarea required value={item.description} onChange={(event) => updateItem(index, "description", event.target.value)} rows={2} placeholder="Description chính thức của hãng"/><div className="quote-application-field"><input value={item.application} onChange={(event) => updateItem(index, "application", event.target.value)} placeholder="Ứng dụng của khách (tự lấy từ CRM)"/>{opportunity && <button type="button" title="Lấy lại Sản phẩm / ứng dụng từ cơ hội CRM" onClick={() => updateItem(index, "application", opportunity.productApplication)}><Icon name="refresh" size={13}/>Lấy từ CRM</button>}</div><div><input value={item.origin} onChange={(event) => updateItem(index, "origin", event.target.value.toUpperCase())} placeholder="Origin"/><input value={item.warranty} onChange={(event) => updateItem(index, "warranty", event.target.value)} placeholder="Warranty"/></div></div><input value={item.unit} onChange={(event) => updateItem(index, "unit", event.target.value)} placeholder="EA"/><input required type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => updateItem(index, "quantity", Number(event.target.value))}/><MoneyInput required decimals={draft.currency.toUpperCase() === "VND" ? 0 : 2} value={item.listPrice} onChange={(value) => setListPrice(index, value)}/><input required type="number" min="0" max="100" step="0.01" value={item.discountPercent} onChange={(event) => setDiscount(index, Number(event.target.value))}/><div className="manual-price-field"><MoneyInput required ariaLabel="Giá chốt" decimals={draft.currency.toUpperCase() === "VND" ? 0 : 2} value={item.unitPrice} onChange={(value) => setUnitPrice(index, value)}/><small>Nhập tự do</small></div><strong>{quoteMoney(roundDraftMoney(item.quantity * item.unitPrice), draft.currency)}</strong><button type="button" aria-label="Xóa dòng" disabled={draft.items.length === 1} onClick={() => update("items", draft.items.filter((_item, itemIndex) => itemIndex !== index))}><Icon name="trash" size={16}/></button></div>)}</div>
            <div className="quote-price-note"><Icon name="check" size={15}/><span><strong>Giá chốt</strong> có thể nhập tự do, không phụ thuộc tỷ giá hoặc % chiết khấu. File Excel gửi khách chỉ hiển thị đúng giá chốt này.</span></div>
            <div className="quote-totals"><div><span>Tạm tính</span><strong>{quoteMoney(subtotal, draft.currency)}</strong></div><div><span>VAT {draft.vatRate}%</span><strong>{quoteMoney(vatAmount, draft.currency)}</strong></div><div className="grand-total"><span>Tổng cộng</span><strong>{quoteMoney(total, draft.currency)}</strong></div></div>
          </section>
          <section className="form-section"><div className="form-grid">
            <FormField label="Người lập báo giá" wide><input value={draft.preparedBy} onChange={(event) => update("preparedBy", event.target.value)}/></FormField>
            <FormField label="Trạng thái"><select value={draft.status} onChange={(event) => update("status", event.target.value as QuoteDraft["status"])}><option>Draft</option><option>Sent</option><option>Accepted</option><option>Expired</option></select></FormField>
            <FormField label="Ghi chú nội bộ"><textarea value={draft.notes} onChange={(event) => update("notes", event.target.value)} rows={2} placeholder="Không in ra báo giá"/></FormField>
          </div></section>
        </div>
        <footer className="modal-footer"><span><Icon name="download" size={15}/> File xuất ra là Excel .xlsx theo mẫu Loriot</span><div><button type="button" className="secondary-button modal-cancel" onClick={onClose}>Hủy</button><button type="submit" name="quoteAction" value="save" className="secondary-button save-button" disabled={saving}>{saving ? "Đang lưu..." : <><Icon name="check" size={16}/>Lưu</>}</button><button type="submit" name="quoteAction" value="save-export" className="primary-button save-button quote-export-button" disabled={saving}>{saving ? "Đang xử lý..." : <><Icon name="download" size={16}/>Lưu & xuất Excel</>}</button></div></footer>
      </form>
    </div>
  </div>;
}

function FormField({ label, required, hint, children, wide }: { label: string; required?: boolean; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={`form-field ${wide ? "field-wide" : ""}`}><span>{label}{required && <b>*</b>}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function CustomerCodePicker({ value, accounts, lookupEnabled, onChange, onSelect }: {
  value: string;
  accounts: Account[];
  lookupEnabled: boolean;
  onChange: (value: string) => void;
  onSelect: (account: Account) => void;
}) {
  const [open, setOpen] = useState(false);
  const normalizedValue = normalizeCustomerCode(value);
  const matches = useMemo(() => {
    if (!lookupEnabled) return [];
    return accounts
      .filter((account) => account.customerCode && (!normalizedValue
        || normalizeCustomerCode(account.customerCode).includes(normalizedValue)
        || normalizeCustomerCode(account.companyName).includes(normalizedValue)))
      .slice(0, 8);
  }, [accounts, lookupEnabled, normalizedValue]);
  const exact = accounts.find((account) => normalizeCustomerCode(account.customerCode) === normalizedValue);
  const choose = (account: Account) => { onSelect(account); setOpen(false); };
  return <div className="customer-code-picker">
    <input
      required
      role="combobox"
      aria-label="Mã khách hàng"
      aria-autocomplete="list"
      aria-expanded={open && matches.length > 0}
      value={value}
      maxLength={16}
      placeholder="Gõ mã hoặc tên công ty..."
      onFocus={() => { if (lookupEnabled) setOpen(true); }}
      onChange={(event) => { onChange(normalizeCustomerCode(event.target.value)); if (lookupEnabled) setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
        if (event.key === "Enter" && open && matches[0]) { event.preventDefault(); choose(matches[0]); }
      }}
      onBlur={() => { if (exact && lookupEnabled) onSelect(exact); window.setTimeout(() => setOpen(false), 130); }}
    />
    {exact && <span className="customer-code-match"><Icon name="check" size={12}/>{exact.companyName}</span>}
    {open && matches.length > 0 && <div className="customer-code-menu" role="listbox">
      {matches.map((account) => <button type="button" role="option" aria-selected={account.id === exact?.id} key={account.id} onMouseDown={(event) => { event.preventDefault(); choose(account); }}>
        <span><strong>{account.customerCode}</strong><small>{account.accountType}{account.region ? ` · ${account.region}` : ""}</small></span>
        <b>{account.companyName}</b>
      </button>)}
    </div>}
  </div>;
}

function OpportunityModal({ draft, setDraft, accounts, contacts, pricing, activities, onSaveActivity, onDeleteActivity, onClose, onSubmit, saving }: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  accounts: Account[];
  contacts: Contact[];
  pricing: PricingSettings | null;
  activities: Activity[];
  onSaveActivity: (activity: ActivityDraft) => Promise<boolean>;
  onDeleteActivity: (activity: Activity) => Promise<void>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const selectCustomer = (account: Account) => {
    const contact = contacts.find((item) => item.accountId === account.id);
    setDraft({
      ...draft,
      customerCode: account.customerCode,
      companyName: account.companyName,
      accountType: account.accountType,
      industry: account.industry,
      region: account.region,
      website: account.website,
      accountNotes: account.notes,
      owner: account.owner || draft.owner,
      contactName: contact?.fullName ?? "",
      title: contact?.title ?? "",
      department: contact?.department ?? "",
      buyingRole: contact?.buyingRole || "Technical Influencer",
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      zalo: contact?.zalo ?? "",
      preferredChannel: contact?.preferredChannel || "Zalo",
    });
  };
  const changeCustomerCode = (value: string) => {
    const linkedAccount = accounts.find((account) => normalizeCustomerCode(account.customerCode) === normalizeCustomerCode(draft.customerCode));
    if (!draft.id && linkedAccount && normalizeCustomerCode(value) !== normalizeCustomerCode(linkedAccount.customerCode)) {
      setDraft({
        ...draft,
        customerCode: value,
        companyName: "",
        accountType: "End-User",
        industry: "",
        region: "",
        website: "",
        accountNotes: "",
        contactName: "",
        title: "",
        department: "",
        buyingRole: "Technical Influencer",
        phone: "",
        email: "",
        zalo: "",
        preferredChannel: "Zalo",
      });
      return;
    }
    update("customerCode", value);
  };
  const updateProductLines = (lines: OpportunityProductLine[], syncEstimatedValue = false) => setDraft({
    ...draft,
    productLines: lines,
    productApplication: formatOpportunityProductLines(lines),
    estimatedValue: syncEstimatedValue
      ? Math.round(lines.reduce((sum, line) => sum + Math.max(1, line.quantity) * line.listPrice, 0))
      : draft.estimatedValue,
  });
  const updateProductLine = (index: number, patch: Partial<OpportunityProductLine>, syncEstimatedValue = false) => updateProductLines(
    draft.productLines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
    syncEstimatedValue,
  );
  const changePipelineGroup = (key: string) => {
    const group = PIPELINE_GROUPS.find((item) => item.key === key);
    if (group) setDraft({ ...draft, stage: group.moveTo, lostReason: group.key === "closed" ? draft.lostReason : "" });
  };
  const changeClosedResult = (stage: StageName) => setDraft({
    ...draft,
    stage,
    lostReason: stage === "Closed Won" ? "" : draft.lostReason,
  });
  const selectedGroup = pipelineGroupForStage(draft.stage);
  const score = calculateScore({ ...draft, status: draft.stage === "Closed Won" ? "Won" : draft.stage === "Closed Lost" ? "Lost" : "Open" });
  const temperature = getTemperature(score);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`modal opportunity-modal ${draft.id ? "is-edit" : "is-create"}`} role="dialog" aria-modal="true" aria-label={draft.id ? "Cập nhật cơ hội" : "Thêm cơ hội"}>
      <header className="modal-header"><div><span>{draft.id || (draft.sourceLeadId ? `CHUYỂN TỪ ${draft.sourceLeadId}` : "CƠ HỘI MỚI")}</span><h2>{draft.id ? "Cập nhật cơ hội" : draft.sourceLeadId ? "Chuyển Lead thành cơ hội" : "Thêm cơ hội mới"}</h2><p>{draft.sourceLeadId ? "Thông tin Lead đã được điền sẵn; bổ sung dữ liệu bán hàng để đưa vào Pipeline." : "Nhập đủ dữ liệu để hệ thống tự chấm điểm và xếp ưu tiên."}</p></div><button className="modal-close" onClick={onClose} aria-label="Đóng"><Icon name="close"/></button></header>
      <form onSubmit={onSubmit} autoComplete="off">
        <div className="modal-body">
          <section className="form-section"><div className="section-title"><div><Icon name="building" size={18}/></div><span><strong>Thông tin công ty</strong><small>Account</small></span></div><div className="form-grid">
            <FormField label="Mã khách hàng" required hint={draft.id ? "Mã đang liên kết với hồ sơ khách hàng này" : "Gõ mã hoặc tên công ty; chọn gợi ý để tự điền thông tin"}><CustomerCodePicker value={draft.customerCode} accounts={accounts} lookupEnabled={!draft.id} onChange={changeCustomerCode} onSelect={selectCustomer}/></FormField>
            <FormField label="Tên công ty" required><input required value={draft.companyName} onChange={(e) => update("companyName", e.target.value)} placeholder="Ví dụ: Nhà máy ABC"/></FormField>
            <FormField label="Loại khách hàng" required><select value={draft.accountType} onChange={(e) => update("accountType", e.target.value)}>{ACCOUNT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></FormField>
            <FormField label="Ngành"><input value={draft.industry} onChange={(e) => update("industry", e.target.value)} placeholder="Điện tử, thực phẩm, điện lực..."/></FormField>
            <FormField label="Khu vực"><input value={draft.region} onChange={(e) => update("region", e.target.value)} placeholder="Hà Nội, TP. HCM..."/></FormField>
          </div></section>
          <section className="form-section"><div className="section-title"><div><Icon name="person" size={18}/></div><span><strong>Người liên hệ</strong><small>Contact & Buying Role</small></span></div><div className="form-grid">
            <FormField label="Họ và tên" required><input required value={draft.contactName} onChange={(e) => update("contactName", e.target.value)} placeholder="Nguyễn Văn A"/></FormField>
            <FormField label="Chức danh"><input value={draft.title} onChange={(e) => update("title", e.target.value)} placeholder="Trưởng phòng Bảo trì"/></FormField>
            <FormField label="Bộ phận"><input value={draft.department} onChange={(e) => update("department", e.target.value)} placeholder="Bảo trì / Kỹ thuật / Mua hàng"/></FormField>
            <FormField label="Vai trò mua hàng"><select value={draft.buyingRole} onChange={(e) => update("buyingRole", e.target.value)}>{BUYING_ROLES.map((role) => <option key={role}>{role}</option>)}</select></FormField>
            <FormField label="Điện thoại"><input value={draft.phone} onChange={(e) => update("phone", e.target.value)} inputMode="tel" placeholder="09xx xxx xxx"/></FormField>
            <FormField label="Email"><input value={draft.email} onChange={(e) => update("email", e.target.value)} type="email" placeholder="email@company.vn"/></FormField>
            <FormField label="Zalo"><input value={draft.zalo} onChange={(e) => update("zalo", e.target.value)} placeholder="Số điện thoại / tên Zalo"/></FormField>
            <FormField label="Kênh ưu tiên"><select value={draft.preferredChannel} onChange={(e) => update("preferredChannel", e.target.value)}><option>Zalo</option><option>Phone</option><option>Email</option><option>Meeting</option></select></FormField>
          </div></section>
          <section className={`form-section end-user-section ${["Trading Partner", "System Integrator"].includes(draft.accountType) ? "is-relevant" : ""}`}><div className="section-title"><div><Icon name="target" size={18}/></div><span><strong>End-User cuối cùng</strong><small>{["Trading Partner", "System Integrator"].includes(draft.accountType) ? "Nên nhập khi Partner hỏi giá cho khách cuối" : "Không bắt buộc với khách mua trực tiếp"}</small></span><div className="internal-badge">NỘI BỘ</div></div><div className="form-grid">
            <FormField label="Tên công ty End-User"><input value={draft.endUserCompany} onChange={(e) => update("endUserCompany", e.target.value)} placeholder="Ví dụ: Nhà máy ABC"/></FormField>
            <FormField label="Ngành / lĩnh vực"><input value={draft.endUserIndustry} onChange={(e) => update("endUserIndustry", e.target.value)} placeholder="Điện lực, thực phẩm, điện tử..."/></FormField>
            <FormField label="Địa chỉ End-User" wide><input value={draft.endUserAddress} onChange={(e) => update("endUserAddress", e.target.value)} placeholder="KCN, tỉnh/thành phố..."/></FormField>
            <FormField label="Người liên hệ End-User"><input value={draft.endUserContactName} onChange={(e) => update("endUserContactName", e.target.value)} placeholder="Nếu Partner cung cấp"/></FormField>
            <FormField label="Chức danh / bộ phận"><input value={draft.endUserTitle} onChange={(e) => update("endUserTitle", e.target.value)} placeholder="Bảo trì / Kỹ thuật / Mua hàng"/></FormField>
            <FormField label="Điện thoại"><input value={draft.endUserPhone} onChange={(e) => update("endUserPhone", e.target.value)} inputMode="tel"/></FormField>
            <FormField label="Email"><input value={draft.endUserEmail} onChange={(e) => update("endUserEmail", e.target.value)} type="email"/></FormField>
            <FormField label="Ghi chú End-User" wide><textarea value={draft.endUserNotes} onChange={(e) => update("endUserNotes", e.target.value)} rows={2} placeholder="Dự án, ứng dụng, thông tin Partner đã chia sẻ..."/></FormField>
          </div></section>
          <section className="form-section"><div className="section-title"><div><Icon name="briefcase" size={18}/></div><span><strong>Cơ hội bán hàng</strong><small>Opportunity & Next Step</small></span></div><div className="form-grid">
            <div className="opportunity-products field-wide"><div className="opportunity-products-title"><div><strong>Sản phẩm / ứng dụng <b>*</b></strong><span>Chọn Model để tự điền mô tả và giá; giá trị dự kiến được cộng theo số lượng.</span></div><button type="button" className="secondary-button" onClick={() => updateProductLines([...draft.productLines, { model: "", description: "", quantity: 1, listPrice: 0 }])}><Icon name="plus" size={15}/>Thêm dòng</button></div><div className="opportunity-products-head"><span>STT</span><span>Model</span><span>Mô tả / ứng dụng</span><span>SL</span><span>Giá tham khảo</span><span /></div>{draft.productLines.map((line, index) => <div className="opportunity-product-row" key={index}><b>{index + 1}</b><ProductPicker pricing={pricing} required value={line.model} onChange={(model) => updateProductLine(index, { model, listPrice: 0 }, true)} onSelect={(product) => updateProductLine(index, { model: product.model, description: product.description, listPrice: product.listPriceVnd }, true)}/><textarea required rows={2} value={line.description} onChange={(event) => updateProductLine(index, { description: event.target.value })} placeholder="Mô tả thiết bị hoặc ứng dụng của khách"/><input className="opportunity-quantity" aria-label="Số lượng" type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateProductLine(index, { quantity: Math.max(1, Number(event.target.value) || 1) }, true)}/><div className="opportunity-line-price"><strong>{line.listPrice ? money(line.listPrice) : "Chọn Model"}</strong><small>{line.listPrice ? `${line.quantity} × giá quy đổi` : "Để lấy giá"}</small></div><button type="button" title="Xóa dòng sản phẩm" aria-label="Xóa dòng sản phẩm" disabled={draft.productLines.length === 1} onClick={() => updateProductLines(draft.productLines.filter((_line, lineIndex) => lineIndex !== index), true)}><Icon name="trash" size={15}/></button></div>)}</div>
            <FormField label="Nhu cầu / Pain point" wide><textarea value={draft.needPain} onChange={(e) => update("needPain", e.target.value)} placeholder="Vấn đề khách hàng đang cần giải quyết..." rows={3}/></FormField>
            <FormField label="Giai đoạn" required hint="Chỉ còn 6 giai đoạn giống Pipeline"><select value={selectedGroup.key} onChange={(e) => changePipelineGroup(e.target.value)}>{PIPELINE_GROUPS.map((group) => <option value={group.key} key={group.key}>{group.label}</option>)}</select></FormField>
            {selectedGroup.key === "closed" && <FormField label="Kết quả dự án" required><select value={draft.stage} onChange={(e) => changeClosedResult(e.target.value as StageName)}><option value="Closed Won">Thành công</option><option value="Closed Lost">Thất bại</option></select></FormField>}
            <FormField label="Giá trị dự kiến (VND)" hint="Tự cộng từ Model × số lượng; bạn vẫn có thể sửa tay"><MoneyInput value={draft.estimatedValue} onChange={(value) => update("estimatedValue", value)} placeholder="180.000.000"/></FormField>
            <FormField label="Ngày dự kiến chốt"><input value={draft.expectedCloseDate} onChange={(e) => update("expectedCloseDate", e.target.value)} type="date"/></FormField>
            <FormField label="Ngày liên hệ gần nhất"><input value={draft.lastContactDate} onChange={(e) => update("lastContactDate", e.target.value)} type="date"/></FormField>
            <FormField label="Next Step" required={!["Closed Won", "Closed Lost"].includes(draft.stage)}><input required={!["Closed Won", "Closed Lost"].includes(draft.stage)} value={draft.nextStep} onChange={(e) => update("nextStep", e.target.value)} placeholder="Hành động cụ thể tiếp theo"/></FormField>
            <FormField label="Hạn Next Step" required={!["Closed Won", "Closed Lost"].includes(draft.stage)}><input required={!["Closed Won", "Closed Lost"].includes(draft.stage)} value={draft.nextStepDue} onChange={(e) => update("nextStepDue", e.target.value)} type="date"/></FormField>
            <FormField label="Đối thủ"><input value={draft.competitor} onChange={(e) => update("competitor", e.target.value)} placeholder="Nếu có"/></FormField>
            <FormField label="Lý do thất bại"><input value={draft.lostReason} onChange={(e) => update("lostReason", e.target.value)} disabled={draft.stage !== "Closed Lost"} placeholder="Nhập khi dự án thất bại"/></FormField>
            <FormField label="Ghi chú" wide><textarea value={draft.notes} onChange={(e) => update("notes", e.target.value)} rows={3} placeholder="Thông tin quan trọng cần nhớ..."/></FormField>
          </div></section>
          <section className="form-section scoring-section"><div className="section-title"><div><Icon name="target" size={18}/></div><span><strong>Lead Scoring tự động</strong><small>Chấm 0–5 cho từng tiêu chí</small></span><div className={`live-score live-${temperature.toLowerCase()}`}><span>{temperature}</span><strong>{score}/100</strong></div></div><div className="score-grid">
            {SCORE_FIELDS.map((field) => <label className="score-field" key={field.key}><span>{field.label}<small>Trọng số {field.weight}%</small></span><select value={draft[field.key]} onChange={(e) => update(field.key, Number(e.target.value))}><option value={0}>0 — Chưa có</option><option value={1}>1 — Rất thấp</option><option value={2}>2 — Thấp</option><option value={3}>3 — Trung bình</option><option value={4}>4 — Tốt</option><option value={5}>5 — Rất tốt</option></select></label>)}
          </div><p className="score-note">Điểm cuối còn tự điều chỉnh theo độ mới của lần liên hệ và tình trạng Next Step.</p></section>
          <FollowUpPanel
            opportunityId={draft.id}
            contactName={draft.contactName}
            owner={draft.owner}
            activities={activities}
            saving={saving}
            onSave={onSaveActivity}
            onDelete={onDeleteActivity}
          />
        </div>
        <footer className="modal-footer"><span><b>*</b> Trường bắt buộc</span><div><button type="button" className="secondary-button modal-cancel" onClick={onClose}>Hủy</button><button type="submit" name="opportunityAction" value="save" className="secondary-button save-button" disabled={saving}>{saving ? "Đang lưu..." : draft.id ? "Lưu thay đổi" : "Tạo cơ hội"}</button><button type="submit" name="opportunityAction" value="save-quote" className="primary-button opportunity-quote-button" disabled={saving}>{saving ? "Đang xử lý..." : <><Icon name="file" size={16}/>Lưu & chuyển sang báo giá</>}</button></div></footer>
      </form>
    </div>
  </div>;
}
