import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/settings";
import { DEFAULT_CONFIG, RULES } from "@/lib/config";

export const runtime = "nodejs";

// GET /api/settings — current rule config + the rule catalogue for the UI
export async function GET() {
  const r = await loadConfig();
  return NextResponse.json({ ...r, defaults: DEFAULT_CONFIG, rules: RULES });
}

// PUT /api/settings — save (input is validated and clamped server-side)
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  try {
    const config = await saveConfig(body.reset ? DEFAULT_CONFIG : body.config);
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
