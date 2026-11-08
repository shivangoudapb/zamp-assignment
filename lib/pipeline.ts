import "server-only";
import { BUCKET, db } from "./supabase";
import { extractInvoice } from "./gemini";
import { checkAmountsAndDuplicates, checkVendor, decide, matchPo, validate, type HistoryRun, type StageResult } from "./rules";
import { normId } from "./match";
import { loadConfig } from "./settings";
import { STAGES, type Extraction, type Finding, type PurchaseOrder, type StageKey, type StepStatus, type Vendor } from "./types";

// Stages that finish in milliseconds are held on screen briefly so a viewer can follow along.
// Set STAGE_MIN_MS=0 to disable. Real work time is still what gets recorded in duration_ms.
const STAGE_MIN_MS = Number(process.env.STAGE_MIN_MS ?? 450);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function createStepRows(runId: string) {
  const { error } = await db().from("run_steps").insert(
    STAGES.map((s, i) => ({ run_id: runId, seq: i + 1, stage: s.key, label: s.label, status: "pending" })),
  );
  if (error) throw error;
}

async function setStep(runId: string, stage: StageKey, patch: { status: StepStatus; summary?: string; detail?: unknown; started?: boolean }) {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { status: patch.status };
  if (patch.summary !== undefined) row.summary = patch.summary;
  if (patch.detail !== undefined) row.detail = patch.detail;
  if (patch.started) row.started_at = now;
  if (["done", "warn", "failed", "skipped"].includes(patch.status)) row.finished_at = now;
  await db().from("run_steps").update(row).eq("run_id", runId).eq("stage", stage);
}

/** Runs one stage: marks it running, executes, records result + findings. */
async function stage<T extends StageResult>(runId: string, key: StageKey, all: Finding[], fn: () => Promise<T> | T): Promise<T> {
  await setStep(runId, key, { status: "running", started: true });
  const t0 = Date.now();
  const res = await fn();
  const elapsed = Date.now() - t0;
  if (elapsed < STAGE_MIN_MS) await sleep(STAGE_MIN_MS - elapsed);
  all.push(...res.findings);
  await setStep(runId, key, { status: res.status, summary: res.summary, detail: { ...res.detail, findings: res.findings, ms: elapsed } });
  return res;
}

export async function runPipeline(runId: string, file: Buffer, mimeType: string, fileName: string, fileHash: string) {
  const started = Date.now();
  const findings: Finding[] = [];
  let current: StageKey = "ingest";

  try {
    // 1. INGEST — store the original, fingerprint it, detect whether it has a text layer
    await stage(runId, "ingest", findings, async () => {
      const path = `${runId}/${fileName.replace(/[^\w.\-]/g, "_")}`;
      const up = await db().storage.from(BUCKET).upload(path, file, { contentType: mimeType, upsert: true });
      if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);
      await db().from("runs").update({ file_path: path }).eq("id", runId);
      const isPdf = mimeType === "application/pdf";
      const hasText = isPdf && file.toString("latin1").includes("/Font");
      const kind = !isPdf ? "image" : hasText ? "digital PDF (text layer)" : "image-only PDF (no text layer)";
      return {
        status: "done" as StepStatus,
        summary: `${kind} · ${(file.length / 1024).toFixed(1)} KB`,
        detail: { file_name: fileName, mime_type: mimeType, size_bytes: file.length, sha256: fileHash, text_layer: hasText },
        findings: [],
      };
    });

    // Reference data loaded once
    current = "extract";
    const [{ data: vendors }, { data: pos }, { data: history }, { config: cfg }] = await Promise.all([
      db().from("vendors").select("*"),
      db().from("purchase_orders").select("*"),
      db().from("runs").select("id,run_no,vendor_id,invoice_number,invoice_number_norm,invoice_date,po_number,total,decision,review_decision,file_hash,created_at").eq("status", "done"),
      loadConfig(),
    ]);
    const V = (vendors ?? []) as Vendor[];
    const P = ((pos ?? []) as PurchaseOrder[]).map((p) => ({ ...p, amount: Number(p.amount) }));
    const Hs = ((history ?? []) as HistoryRun[]).map((h) => ({ ...h, total: h.total == null ? null : Number(h.total) }));

    // 2. EXTRACT — the only AI step
    let ex!: Extraction;
    await stage(runId, "extract", findings, async () => {
      const r = await extractInvoice(file, mimeType);
      ex = r.data;
      const c = ex.confidence;
      const minConf = Math.min(c.vendor_name, c.invoice_number, c.invoice_date, c.total);
      await db().from("runs").update({
        extracted: ex, vendor_name: ex.vendor_name, invoice_number: ex.invoice_number,
        invoice_number_norm: normId(ex.invoice_number) || null, invoice_date: ex.invoice_date, currency: ex.currency, total: ex.total,
      }).eq("id", runId);
      return {
        status: "done" as StepStatus,
        summary: `${ex.line_items.length} line items · total ${ex.total ?? "?"} ${ex.currency ?? ""} · min confidence ${Math.round(minConf * 100)}%`,
        detail: { model: r.model, model_ms: r.ms, extracted: ex },
        findings: [],
      };
    });

    // 3. VALIDATE
    current = "validate";
    const val = await stage(runId, "validate", findings, () => validate(ex, cfg));
    const notInvoice = val.findings.some((x) => x.code === "NOT_AN_INVOICE");

    // 4. VENDOR
    current = "vendor";
    let vendor: Vendor | null = null;
    if (notInvoice) await setStep(runId, "vendor", { status: "skipped", summary: "Skipped — not an invoice" });
    else {
      const vr = await stage(runId, "vendor", findings, () => checkVendor(ex, V, cfg));
      vendor = vr.vendor;
    }

    // 5. PO MATCH
    current = "po_match";
    let po: PurchaseOrder | null = null;
    let method: "explicit" | "inferred" | "none" = "none";
    if (notInvoice) await setStep(runId, "po_match", { status: "skipped", summary: "Skipped — not an invoice" });
    else {
      const pr = await stage(runId, "po_match", findings, () => matchPo(ex, vendor, P, Hs, runId, cfg));
      po = pr.po;
      method = pr.method;
    }

    // 6. AMOUNT & DUPLICATES
    current = "checks";
    if (notInvoice) await setStep(runId, "checks", { status: "skipped", summary: "Skipped — not an invoice" });
    else await stage(runId, "checks", findings, () => checkAmountsAndDuplicates(ex, vendor, po, Hs, runId, fileHash, cfg));

    // 7. DECIDE
    current = "decide";
    const d = decide(findings, { vendorName: vendor?.name ?? ex.vendor_name, invoiceNumber: ex.invoice_number, total: ex.total, po: po?.po_number, dueDate: ex.due_date });
    await stage(runId, "decide", [], () => ({
      status: d.status,
      summary: d.decision === "APPROVE" ? "Approved" : d.decision === "HOLD" ? `On hold · ${d.counts.hold} issue(s)` : "Rejected",
      // Snapshot of the rules this decision was made under — audit trail if rules change later.
      detail: { decision: d.decision, counts: d.counts, next_action: d.next_action, rules: cfg },
      findings: [],
    }));

    await db().from("runs").update({
      status: "done", decision: d.decision, summary: d.summary, next_action: d.next_action, reasons: findings,
      vendor_id: vendor?.id ?? null, po_number: po?.po_number ?? null, po_match_method: method,
      finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
    }).eq("id", runId);
  } catch (e) {
    // Fail safe: anything unexpected routes the invoice to a human — never silently approves.
    const msg = e instanceof Error ? e.message : String(e);
    await setStep(runId, current, { status: "failed", summary: msg.slice(0, 200) });
    const idx = STAGES.findIndex((s) => s.key === current);
    for (const s of STAGES.slice(idx + 1)) await setStep(runId, s.key, { status: "skipped", summary: "Skipped — earlier stage failed" });
    await db().from("runs").update({
      status: "failed", decision: "HOLD", error: msg,
      summary: `Could not be processed automatically (${current} stage failed) — routed to manual review.`,
      next_action: "Process this invoice manually; the error has been logged.",
      reasons: [...findings, { code: "PIPELINE_ERROR", severity: "hold", stage: current, message: msg }],
      finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
    }).eq("id", runId);
  }
}
