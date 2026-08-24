import type { CrmDatabase } from "@/db";
import {
  DEFAULT_ROUNDING_STEP,
  DEFAULT_USD_VND_RATE,
  parseVietcombankUsdRate,
  type PricingSettings,
  type PricingSettingsInput,
} from "@/lib/pricing";

const VIETCOMBANK_XML_URL = "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx";
const CACHE_DURATION_MS = 5 * 60 * 1_000;

type PricingRow = {
  useManualRate: number;
  manualRate: number;
  bufferPercent: number;
  roundingStep: number;
  lastLiveRate: number;
  sourceUpdatedAt: string;
  fetchedAt: string;
};

const selectPricing = `SELECT use_manual_rate AS useManualRate, manual_rate AS manualRate,
  buffer_percent AS bufferPercent, rounding_step AS roundingStep, last_live_rate AS lastLiveRate,
  source_updated_at AS sourceUpdatedAt, fetched_at AS fetchedAt
  FROM pricing_settings WHERE id = 'default'`;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

async function ensurePricingRow(db: CrmDatabase) {
  await db.prepare(`INSERT INTO pricing_settings (id, use_manual_rate, manual_rate, buffer_percent,
      rounding_step, last_live_rate, source_updated_at, fetched_at, updated_at)
    VALUES ('default', 0, 0, 0, ?, ?, '', '', ?)
    ON CONFLICT(id) DO NOTHING`).bind(
    DEFAULT_ROUNDING_STEP, DEFAULT_USD_VND_RATE, new Date().toISOString(),
  ).run();
}

function toSettings(row: PricingRow): PricingSettings {
  const liveRate = row.lastLiveRate > 0 ? row.lastLiveRate : DEFAULT_USD_VND_RATE;
  const useManualRate = Boolean(row.useManualRate) && row.manualRate > 0;
  return {
    useManualRate,
    manualRate: row.manualRate,
    bufferPercent: row.bufferPercent,
    roundingStep: row.roundingStep || DEFAULT_ROUNDING_STEP,
    liveRate,
    effectiveRate: useManualRate ? row.manualRate : liveRate,
    source: "Vietcombank — tỷ giá bán USD",
    sourceUpdatedAt: row.sourceUpdatedAt,
    fetchedAt: row.fetchedAt,
    liveAvailable: Boolean(row.sourceUpdatedAt),
  };
}

async function refreshLiveRate(db: CrmDatabase, row: PricingRow) {
  const fetchedTime = Date.parse(row.fetchedAt);
  if (Number.isFinite(fetchedTime) && Date.now() - fetchedTime < CACHE_DURATION_MS) return row;
  try {
    const response = await fetch(VIETCOMBANK_XML_URL, {
      headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Vietcombank phản hồi ${response.status}.`);
    const live = parseVietcombankUsdRate(await response.text());
    const now = new Date().toISOString();
    await db.prepare(`UPDATE pricing_settings SET last_live_rate = ?, source_updated_at = ?,
      fetched_at = ?, updated_at = ? WHERE id = 'default'`).bind(
      live.rate, live.sourceUpdatedAt, now, now,
    ).run();
    return { ...row, lastLiveRate: live.rate, sourceUpdatedAt: live.sourceUpdatedAt, fetchedAt: now };
  } catch (error) {
    console.warn("Live USD/VND refresh failed; using the last saved rate.", error);
    return row;
  }
}

export async function getPricingSettings(db: CrmDatabase, refresh = false) {
  await ensurePricingRow(db);
  let row = await db.prepare(selectPricing).first<PricingRow>();
  if (!row) throw new Error("Không thể khởi tạo cấu hình tỷ giá.");
  if (refresh) row = await refreshLiveRate(db, row);
  return toSettings(row);
}

export async function savePricingSettings(db: CrmDatabase, input: PricingSettingsInput) {
  await ensurePricingRow(db);
  const useManualRate = Boolean(input.useManualRate);
  const manualRate = clamp(Number(input.manualRate) || 0, 0, 100_000);
  if (useManualRate && manualRate < 10_000) throw new Error("Tỷ giá nhập tay phải từ 10.000 VND/USD.");
  const bufferPercent = clamp(Number(input.bufferPercent) || 0, 0, 30);
  const roundingStep = [1, 100, 1_000, 10_000].includes(Number(input.roundingStep))
    ? Number(input.roundingStep)
    : DEFAULT_ROUNDING_STEP;
  await db.prepare(`UPDATE pricing_settings SET use_manual_rate = ?, manual_rate = ?, buffer_percent = ?,
    rounding_step = ?, updated_at = ? WHERE id = 'default'`).bind(
    useManualRate ? 1 : 0, manualRate, bufferPercent, roundingStep, new Date().toISOString(),
  ).run();
  return getPricingSettings(db, false);
}
