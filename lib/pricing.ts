export const DEFAULT_USD_VND_RATE = 26_310;
export const DEFAULT_ROUNDING_STEP = 1_000;

export type PricingSettings = {
  useManualRate: boolean;
  manualRate: number;
  bufferPercent: number;
  roundingStep: number;
  liveRate: number;
  effectiveRate: number;
  source: string;
  sourceUpdatedAt: string;
  fetchedAt: string;
  liveAvailable: boolean;
};

export type PricingSettingsInput = Pick<
  PricingSettings,
  "useManualRate" | "manualRate" | "bufferPercent" | "roundingStep"
>;

export function calculateVndPrice(
  usdPrice: number,
  exchangeRate: number,
  bufferPercent: number,
  roundingStep = DEFAULT_ROUNDING_STEP,
) {
  if (!Number.isFinite(usdPrice) || usdPrice <= 0 || !Number.isFinite(exchangeRate) || exchangeRate <= 0) return 0;
  const safeBuffer = Math.max(0, Math.min(30, Number(bufferPercent) || 0));
  const safeStep = [1, 100, 1_000, 10_000].includes(roundingStep) ? roundingStep : DEFAULT_ROUNDING_STEP;
  return Math.ceil((usdPrice * exchangeRate * (1 + safeBuffer / 100)) / safeStep) * safeStep;
}

export function parseVietcombankUsdRate(xml: string) {
  const usdTag = xml.match(/<Exrate\b[^>]*CurrencyCode="USD"[^>]*\/>/i)?.[0];
  const sellText = usdTag?.match(/\bSell="([^"]+)"/i)?.[1] ?? "";
  const rate = Number(sellText.replaceAll(",", ""));
  if (!Number.isFinite(rate) || rate < 10_000 || rate > 100_000) {
    throw new Error("Tỷ giá USD từ Vietcombank không hợp lệ.");
  }
  const sourceUpdatedAt = xml.match(/<DateTime>([^<]+)<\/DateTime>/i)?.[1]?.trim() ?? "";
  return { rate, sourceUpdatedAt };
}

export function vietnamGreeting(date: Date) {
  const hourText = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
  const hour = Number(hourText);
  if (hour >= 5 && hour < 12) return "Chào buổi sáng";
  if (hour >= 12 && hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}
