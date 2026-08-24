import { ensureDatabase } from "@/db";
import { getPricingSettings, savePricingSettings } from "@/lib/pricing-server";
import type { PricingSettingsInput } from "@/lib/pricing";

export async function GET() {
  try {
    const db = await ensureDatabase();
    return Response.json(await getPricingSettings(db, true));
  } catch (error) {
    console.error("Pricing settings load failed", error);
    return Response.json({ error: "Không thể tải tỷ giá USD/VND." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as PricingSettingsInput;
    const db = await ensureDatabase();
    return Response.json(await savePricingSettings(db, input));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể lưu cách tính giá.";
    console.error("Pricing settings save failed", error);
    return Response.json({ error: message }, { status: 400 });
  }
}
