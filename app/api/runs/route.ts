import { NextResponse, after } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/supabase";
import { createStepRows, runPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 4 * 1024 * 1024;

// POST /api/runs — upload an invoice, create a run, start the pipeline in the background.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: `Unsupported file type ${file.type || "unknown"} — upload a PDF or image.` }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 4 MB." }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(buf).digest("hex");

  const { data: run, error } = await db()
    .from("runs")
    .insert({ status: "running", file_name: file.name, file_hash: hash, source: "upload" })
    .select("id, run_no")
    .single();
  if (error || !run) return NextResponse.json({ error: error?.message ?? "Could not create run" }, { status: 500 });

  await createStepRows(run.id);
  after(() => runPipeline(run.id, buf, file.type, file.name, hash));

  return NextResponse.json({ id: run.id, run_no: run.run_no });
}

// GET /api/runs — run history for the dashboard
export async function GET() {
  const { data, error } = await db()
    .from("runs")
    .select("id,run_no,source,status,file_name,vendor_name,vendor_id,invoice_number,invoice_date,po_number,po_match_method,total,currency,decision,review_decision,summary,reasons,duration_ms,created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data });
}
