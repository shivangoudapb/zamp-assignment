import { NextResponse } from "next/server";
import { BUCKET, db } from "@/lib/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/runs/:id — run + its stage rows. Polled by the live run view.
// ?file=1 also returns a short-lived signed URL for the original document.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const [{ data: run, error }, { data: steps }] = await Promise.all([
    db().from("runs").select("*").eq("id", id).single(),
    db().from("run_steps").select("*").eq("run_id", id).order("seq"),
  ]);
  if (error || !run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  let file_url: string | null = null;
  if (new URL(req.url).searchParams.get("file") && run.file_path) {
    const { data } = await db().storage.from(BUCKET).createSignedUrl(run.file_path, 60 * 60);
    file_url = data?.signedUrl ?? null;
  }
  return NextResponse.json({ run, steps: steps ?? [], file_url });
}

// DELETE /api/runs/:id — remove a run, its stage log and its stored file.
// Useful for demos: re-uploading a deleted invoice is no longer flagged as a duplicate.
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const { data: run } = await db().from("runs").select("file_path, status").eq("id", id).single();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status === "running") return NextResponse.json({ error: "Run is still processing — wait for it to finish" }, { status: 409 });
  if (run.file_path) await db().storage.from(BUCKET).remove([run.file_path]);
  const { error } = await db().from("runs").delete().eq("id", id); // run_steps cascade
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// PATCH /api/runs/:id — a human reviewer resolves a HOLD (approve or reject, with a note).
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;
  if (action !== "APPROVE" && action !== "REJECT") return NextResponse.json({ error: "action must be APPROVE or REJECT" }, { status: 400 });

  const { data: run } = await db().from("runs").select("decision, review_decision, status").eq("id", id).single();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.decision !== "HOLD") return NextResponse.json({ error: "Only invoices on hold can be reviewed" }, { status: 409 });
  if (run.review_decision) return NextResponse.json({ error: "Already reviewed" }, { status: 409 });

  const { error } = await db().from("runs")
    .update({ review_decision: action, review_note: note, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
