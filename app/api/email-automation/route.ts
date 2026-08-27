import { ensureDatabase } from "@/db";
import {
  deleteCampaign,
  draftCampaignWithAi,
  loadAutomationData,
  runEmailAutomation,
  saveAutomationSettings,
  saveCampaign,
  setCampaignStatus,
} from "@/lib/email-automation";

type Input = Record<string, unknown>;

const textValue = (input: Input, key: string) => {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
};

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new Error("Yêu cầu tự động hóa không đúng nguồn CRM.");
  }
}

export async function GET() {
  try {
    const db = await ensureDatabase();
    return Response.json(await loadAutomationData(db));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể tải tự động hóa email.";
    console.error(JSON.stringify({ message: "email automation load failed", error: message }));
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Dữ liệu tự động hóa email không hợp lệ.");
    }
    const input = value as Input;
    const action = textValue(input, "action");
    const db = await ensureDatabase();
    let result: Record<string, unknown> = {};
    if (action === "saveAutomationSettings") await saveAutomationSettings(db, input);
    else if (action === "saveCampaign") result = await saveCampaign(db, input);
    else if (action === "setCampaignStatus") await setCampaignStatus(db, input);
    else if (action === "deleteCampaign") await deleteCampaign(db, input);
    else if (action === "draftCampaignWithAi") result = await draftCampaignWithAi(input);
    else if (action === "runNow") result = await runEmailAutomation(db, "Manual", true);
    else throw new Error("Thao tác tự động hóa email không hợp lệ.");
    return Response.json({ ...await loadAutomationData(db), result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể xử lý tự động hóa email.";
    console.error(JSON.stringify({ message: "email automation operation failed", error: message }));
    return Response.json({ error: message }, { status: 400 });
  }
}
