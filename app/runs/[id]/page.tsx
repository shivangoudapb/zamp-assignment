"use client";
// Stage `detail` is free-form JSON written by the pipeline, so it is typed loosely here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronRight, Clock, ExternalLink, LoaderCircle, Sparkles, Trash2, UserCheck } from "lucide-react";
import { Card, DecisionBadge, SEVERITY_STYLE, StepIcon, timeAgo, usd } from "@/components/ui";
import { STAGES, type Decision, type Extraction, type Finding, type StepStatus } from "@/lib/types";

type Step = { stage: string; label: string; seq: number; status: StepStatus; summary: string | null; detail: Record<string, any> | null; started_at: string | null; finished_at: string | null };
type Run = {
  id: string; run_no: number; source: string; status: "running" | "done" | "failed"; file_name: string; file_path: string | null;
  extracted: Extraction | null; vendor_name: string | null; invoice_number: string | null; total: number | null; currency: string | null;
  po_number: string | null; po_match_method: string | null; decision: Decision | null; summary: string | null; next_action: string | null;
  reasons: Finding[]; review_decision: "APPROVE" | "REJECT" | null; review_note: string | null; reviewed_at: string | null;
  error: string | null; duration_ms: number | null; created_at: string;
};

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"doc" | "fields" | "json">("doc");
  const [elapsed, setElapsed] = useState(0);
  const userToggled = useRef(false);

  const load = useCallback(async (withFile: boolean) => {
    const res = await fetch(`/api/runs/${id}${withFile ? "?file=1" : ""}`, { cache: "no-store" });
    if (res.status === 404) return setNotFound(true);
    const json = await res.json();
    setRun(json.run);
    setSteps(json.steps);
    if (json.file_url) setFileUrl(json.file_url);
    return json.run as Run;
  }, [id]);

  // Poll every second while the pipeline is running
  useEffect(() => {
    let stop = false;
    let haveFile = false;
    (async function tick() {
      const r = await load(!haveFile);
      if (r?.file_path) haveFile = true;
      if (!stop && r && r.status === "running") setTimeout(tick, 1000);
    })();
    return () => { stop = true; };
  }, [load]);

  // Live stopwatch
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const t = setInterval(() => setElapsed(Date.now() - new Date(run.created_at).getTime()), 100);
    return () => clearInterval(t);
  }, [run?.status, run?.created_at]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-expand the stage that is running / the ones that raised issues
  useEffect(() => {
    if (userToggled.current) return;
    const next: Record<string, boolean> = {};
    for (const s of steps) if (s.status === "warn" || s.status === "failed") next[s.stage] = true;
    setOpen(next);
  }, [steps]);

  if (notFound) return <div className="py-20 text-center text-muted">Run not found. <Link className="text-brand" href="/">Back to dashboard</Link></div>;
  if (!run) return <div className="flex justify-center py-24"><LoaderCircle className="animate-spin text-muted" /></div>;

  const running = run.status === "running";
  const done = steps.filter((s) => !["pending", "running"].includes(s.status)).length;
  const ms = running ? elapsed : run.duration_ms ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-md p-1.5 text-muted hover:bg-white hover:text-ink"><ArrowLeft size={18} /></Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold">Run #{run.run_no}</h1>
            <DecisionBadge decision={run.decision} review={run.review_decision} status={run.status} size="lg" />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted">
            <span className="truncate">{run.file_name}</span>
            <span className="flex items-center gap-1"><Clock size={13} /> {(ms / 1000).toFixed(1)}s</span>
            <span>{timeAgo(run.created_at)}</span>
          </div>
        </div>
        {!running && <DeleteButton id={run.id} runNo={run.run_no} />}
        {running && (
          <div className="ml-auto w-48">
            <div className="mb-1 text-right text-xs text-muted">{done} / {STAGES.length} stages</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${(done / STAGES.length) * 100}%` }} /></div>
          </div>
        )}
      </div>

      {run.source === "seed" && (
        <div className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-muted">Historical record loaded with the demo data — no document or stage log attached.</div>
      )}

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Pipeline timeline */}
        <div className="lg:col-span-5">
          <Card className="p-2">
            <ol>
              {(steps.length ? steps : STAGES.map((s, i) => ({ stage: s.key, label: s.label, seq: i + 1, status: "pending" as StepStatus, summary: null, detail: null, started_at: null, finished_at: null }))).map((s, i, arr) => {
                const meta = STAGES.find((x) => x.key === s.stage);
                const isOpen = !!open[s.stage];
                const canOpen = !!s.detail;
                const dur = s.started_at && s.finished_at ? new Date(s.finished_at).getTime() - new Date(s.started_at).getTime() : null;
                return (
                  <li key={s.stage} className="relative">
                    {i < arr.length - 1 && <span className={`absolute left-[21px] top-10 h-[calc(100%-28px)] w-px ${["done", "warn"].includes(s.status) ? "bg-emerald-200" : "bg-line"}`} />}
                    <button
                      disabled={!canOpen}
                      onClick={() => { userToggled.current = true; setOpen((o) => ({ ...o, [s.stage]: !o[s.stage] })); }}
                      className={`relative flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left ${canOpen ? "hover:bg-slate-50" : ""} ${s.status === "running" ? "bg-brand-soft" : ""}`}
                    >
                      <span className={`mt-0.5 rounded-full bg-white ${s.status === "running" ? "pulse-ring" : ""}`}><StepIcon status={s.status} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${s.status === "pending" ? "text-muted" : ""}`}>{s.label}</span>
                          {s.stage === "extract" && <span className="inline-flex items-center gap-0.5 rounded bg-violet-50 px-1.5 text-[10px] font-medium text-violet-700"><Sparkles size={10} /> AI</span>}
                          {dur != null && <span className="text-[11px] text-muted">{dur < 1000 ? `${dur}ms` : `${(dur / 1000).toFixed(1)}s`}</span>}
                        </span>
                        <span className={`block text-xs ${s.summary ? "text-slate-600" : "text-muted"}`}>
                          {s.status === "running" ? `${meta?.blurb}…` : s.summary ?? meta?.blurb}
                        </span>
                      </span>
                      {canOpen && (isOpen ? <ChevronDown size={16} className="mt-1 text-muted" /> : <ChevronRight size={16} className="mt-1 text-muted" />)}
                    </button>
                    {isOpen && s.detail && <div className="fade-in mb-2 ml-11 mr-2"><StageDetail stage={s.stage} detail={s.detail} /></div>}
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        {/* Decision + document */}
        <div className="space-y-5 lg:col-span-7">
          <DecisionCard run={run} onReviewed={() => load(false)} />

          <Card>
            <div className="flex border-b border-line px-2">
              {([["doc", "Document"], ["fields", "Extracted fields"], ["json", "Raw JSON"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-3 py-2.5 text-sm ${tab === k ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-ink"}`}>{l}</button>
              ))}
              {fileUrl && <a href={fileUrl} target="_blank" className="ml-auto flex items-center gap-1 px-3 text-xs text-muted hover:text-ink">Open <ExternalLink size={12} /></a>}
            </div>
            <div className="p-3">
              {tab === "doc" && (fileUrl
                ? <iframe src={fileUrl} className="h-[640px] w-full rounded-lg border border-line bg-slate-100" title="Invoice" />
                : <div className="grid h-60 place-items-center text-sm text-muted">{run.source === "seed" ? "No document for historical records." : "Uploading document…"}</div>)}
              {tab === "fields" && <Fields ex={run.extracted} />}
              {tab === "json" && <pre className="max-h-[640px] overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">{JSON.stringify(run.extracted, null, 2) ?? "Not extracted yet"}</pre>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DeleteButton({ id, runNo }: { id: string; runNo: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function del() {
    if (!confirm(`Delete run #${runNo}? Its document and history will be removed, and the same invoice can be processed again.`)) return;
    setBusy(true);
    const res = await fetch(`/api/runs/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/");
    else { alert((await res.json()).error ?? "Delete failed"); setBusy(false); }
  }
  return (
    <button onClick={del} disabled={busy} title="Delete this run"
      className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm text-muted hover:border-rose-300 hover:text-rose-700 disabled:opacity-50">
      {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete run
    </button>
  );
}

// ----------------------------------------------------------------- Decision card
function DecisionCard({ run, onReviewed }: { run: Run; onReviewed: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (run.status === "running") {
    return (
      <Card className="flex items-center gap-3 p-5 text-sm text-muted">
        <LoaderCircle size={18} className="animate-spin text-brand" /> Working through the checks — the decision appears here when all stages finish.
      </Card>
    );
  }

  const issues = (run.reasons ?? []).filter((r) => r.severity !== "pass");
  const passes = (run.reasons ?? []).filter((r) => r.severity === "pass");
  const tone = run.decision === "APPROVE" ? "border-emerald-200" : run.decision === "HOLD" ? "border-amber-200" : "border-rose-200";
  const head = run.decision === "APPROVE" ? "bg-emerald-50" : run.decision === "HOLD" ? "bg-amber-50" : "bg-rose-50";

  async function review(action: "APPROVE" | "REJECT") {
    setBusy(true); setErr(null);
    const res = await fetch(`/api/runs/${run.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, note }) });
    if (!res.ok) setErr((await res.json()).error ?? "Failed");
    setBusy(false);
    onReviewed();
  }

  return (
    <div className={`fade-in overflow-hidden rounded-xl border bg-white ${tone}`}>
      <div className={`px-5 py-4 ${head}`}>
        <div className="flex items-center gap-2"><DecisionBadge decision={run.decision} size="lg" /><span className="text-xs text-muted">system decision</span></div>
        <p className="mt-2 text-[15px] leading-snug">{run.summary}</p>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Vendor" value={run.vendor_name ?? "—"} />
          <Stat label="Invoice #" value={run.invoice_number ?? "—"} />
          <Stat label="Amount" value={usd(run.total)} />
          <Stat label="PO" value={run.po_number ? `${run.po_number}${run.po_match_method === "inferred" ? " (inferred)" : ""}` : "—"} />
        </div>

        {run.next_action && (
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm"><span className="font-medium">Next step: </span>{run.next_action}</div>
        )}

        {issues.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Why</div>
            {issues.map((r, i) => <FindingRow key={i} f={r} />)}
          </div>
        )}
        {passes.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">{passes.length} checks passed</summary>
            <div className="mt-1.5 space-y-1.5">{passes.map((r, i) => <FindingRow key={i} f={r} />)}</div>
          </details>
        )}

        {/* Human in the loop */}
        {run.decision === "HOLD" && !run.review_decision && (
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium"><UserCheck size={15} /> Reviewer action</div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. confirmed PO with requester)"
              className="w-full rounded-md border border-line px-3 py-1.5 text-sm outline-none focus:border-brand" />
            <div className="mt-2 flex gap-2">
              <button disabled={busy} onClick={() => review("APPROVE")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Approve for payment</button>
              <button disabled={busy} onClick={() => review("REJECT")} className="rounded-md border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">Reject</button>
            </div>
            {err && <div className="mt-2 text-xs text-rose-700">{err}</div>}
          </div>
        )}
        {run.review_decision && (
          <div className="rounded-lg border border-line bg-slate-50 px-3 py-2.5 text-sm">
            <span className="font-medium">Reviewed: {run.review_decision === "APPROVE" ? "approved" : "rejected"}</span>
            {run.reviewed_at && <span className="text-muted"> · {timeAgo(run.reviewed_at)}</span>}
            {run.review_note && <div className="mt-0.5 text-muted">“{run.review_note}”</div>}
          </div>
        )}
        {run.error && <div className="rounded-lg bg-rose-50 px-3 py-2 font-mono text-xs text-rose-800">{run.error}</div>}
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0"><div className="text-xs text-muted">{label}</div><div className="truncate font-medium">{value}</div></div>
);

function FindingRow({ f }: { f: Finding }) {
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${SEVERITY_STYLE[f.severity]}`}>
      <span className="mr-1.5 font-mono text-[10px] font-semibold uppercase opacity-70">{f.code}</span>{f.message}
    </div>
  );
}

// ----------------------------------------------------------------- Stage details
function StageDetail({ stage, detail }: { stage: string; detail: Record<string, any> }) {
  const findings: Finding[] = detail.findings ?? [];
  return (
    <div className="space-y-2 rounded-lg border border-line bg-slate-50/60 p-3 text-xs">
      {stage === "ingest" && (
        <KV rows={[["File", detail.file_name], ["Type", detail.mime_type], ["Text layer", detail.text_layer ? "yes" : "no — image only"], ["SHA-256", `${String(detail.sha256).slice(0, 16)}…`]]} />
      )}
      {stage === "extract" && (
        <KV rows={[["Model", detail.model], ["Model time", `${(detail.model_ms / 1000).toFixed(1)}s`], ["Line items", detail.extracted?.line_items?.length], ["Notes", detail.extracted?.notes ?? "—"]]} />
      )}
      {stage === "validate" && detail.math && (
        <KV rows={[["Line items sum", usd(detail.math.line_sum)], ["Subtotal", usd(detail.math.subtotal)], ["Tax", usd(detail.math.tax)], ["Other charges", usd(detail.math.other_charges)], ["Expected total", usd(detail.math.expected_total)], ["Stated total", usd(detail.math.stated_total)]]} />
      )}
      {stage === "vendor" && detail.vendor_id && (
        <KV rows={[["Printed name", detail.printed_name], ["Matched to", `${detail.vendor_name} (${detail.vendor_id})`], ["Match", detail.match], ["Bank on invoice", detail.invoice_bank_last4 ? `…${detail.invoice_bank_last4}` : "not shown"], ["Bank on file", detail.master_bank_last4 ? `…${detail.master_bank_last4}` : "—"]]} />
      )}
      {stage === "po_match" && detail.candidates && (
        <table className="w-full">
          <thead><tr className="text-left text-muted"><th className="py-1 font-medium">Candidate PO</th><th className="font-medium">Remaining</th><th className="font-medium">Lines</th><th className="font-medium">Amount</th><th className="text-right font-medium">Score</th></tr></thead>
          <tbody>{detail.candidates.map((c: any) => (
            <tr key={c.po_number} className="border-t border-line"><td className="py-1">{c.po_number}<div className="text-muted">{c.description}</div></td><td>{usd(c.remaining)}</td><td>{Math.round(c.description_match * 100)}%</td><td>{Math.round(c.amount_fit * 100)}%</td><td className="text-right font-medium">{Math.round(c.score * 100)}%</td></tr>
          ))}</tbody>
        </table>
      )}
      {stage === "checks" && detail.po && <PoBar po={detail.po} />}
      {stage === "decide" && detail.counts && (
        <KV rows={[["Blocking (reject)", detail.counts.reject], ["Needs review (hold)", detail.counts.hold], ["Flagged only", detail.counts.flag ?? 0], ["Checks passed", detail.counts.pass]]} />
      )}
      {stage === "decide" && detail.rules && (
        <div className="rounded-md border border-line bg-white px-2.5 py-2">
          <div className="mb-1 font-medium">Rules applied (snapshot)</div>
          <div className="text-muted">
            Tolerance {detail.rules.tolerancePct}% · min confidence {Math.round(detail.rules.minFieldConfidence * 100)}% · vendor match {Math.round(detail.rules.vendorMatchThreshold * 100)}% ·
            duplicate window {detail.rules.nearDuplicateDays}d · approval limit {detail.rules.approvalLimit != null ? usd(detail.rules.approvalLimit) : "none"} ·
            inferred PO {detail.rules.inferredPoAutoAcceptPct != null ? `auto ≥ ${detail.rules.inferredPoAutoAcceptPct}%` : "human confirms"}
          </div>
        </div>
      )}
      {findings.length > 0 && <div className="space-y-1 pt-1">{findings.map((f, i) => <FindingRow key={i} f={f} />)}</div>}
    </div>
  );
}

function KV({ rows }: { rows: [string, any][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-muted">{k}</dt><dd className="break-words font-medium">{v ?? "—"}</dd></Fragment>))}
    </dl>
  );
}

// Visual PO consumption: already billed | this invoice | remaining (and overrun)
function PoBar({ po }: { po: { po_number: string; po_amount: number; already_billed: number; remaining: number; invoice_total: number; tolerance: number } }) {
  const max = Math.max(po.po_amount, po.already_billed + po.invoice_total);
  const pct = (n: number) => `${(Math.max(0, n) / max) * 100}%`;
  const fits = Math.min(po.invoice_total, Math.max(0, po.remaining));
  const over = po.invoice_total - fits;
  return (
    <div>
      <div className="mb-1 flex justify-between"><span className="font-medium">{po.po_number} balance</span><span className="text-muted">PO value {usd(po.po_amount)}</span></div>
      <div className="relative flex h-4 overflow-hidden rounded bg-slate-200">
        <div className="bg-slate-400" style={{ width: pct(po.already_billed) }} title="Already billed" />
        <div className="bg-blue-500" style={{ width: pct(fits) }} title="This invoice" />
        <div className={over > po.tolerance ? "bg-rose-500" : "bg-amber-400"} style={{ width: pct(over) }} title="Over balance" />
        <div className="absolute inset-y-0 border-r-2 border-dashed border-slate-700" style={{ left: pct(po.po_amount) }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-400" />Billed {usd(po.already_billed)}</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-500" />This invoice {usd(po.invoice_total)}</span>
        {over > 0 && <span><i className={`mr-1 inline-block h-2 w-2 rounded-sm ${over > po.tolerance ? "bg-rose-500" : "bg-amber-400"}`} />Over by {usd(over)} (tolerance {usd(po.tolerance)})</span>}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Extracted fields
function Fields({ ex }: { ex: Extraction | null }) {
  if (!ex) return <div className="grid h-40 place-items-center text-sm text-muted">Not extracted yet.</div>;
  const conf = ex.confidence as Record<string, number>;
  const rows: [string, any, string?][] = [
    ["Vendor", ex.vendor_name, "vendor_name"], ["Tax ID", ex.vendor_tax_id], ["Invoice #", ex.invoice_number, "invoice_number"],
    ["Invoice date", ex.invoice_date, "invoice_date"], ["Due date", ex.due_date], ["PO reference", ex.po_reference ?? "— not printed", "po_reference"],
    ["Bank account", ex.vendor_bank_account], ["Currency", ex.currency], ["Subtotal", usd(ex.subtotal)], ["Tax", usd(ex.tax_amount)],
    ["Other charges", usd(ex.other_charges)], ["Total", usd(ex.total), "total"],
  ];
  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v, c]) => (
            <tr key={k} className="border-b border-line last:border-0">
              <td className="w-36 py-1.5 text-muted">{k}</td>
              <td className="py-1.5 font-medium">{v ?? "—"}</td>
              <td className="w-32 py-1.5">{c && conf?.[c] != null && <Conf v={conf[c]} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Line items</div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-1 font-medium">Description</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">Unit</th><th className="text-right font-medium">Amount</th></tr></thead>
          <tbody>{ex.line_items.map((l, i) => (
            <tr key={i} className="border-b border-line last:border-0"><td className="py-1.5">{l.description}</td><td className="text-right">{l.quantity ?? "—"}</td><td className="text-right">{usd(l.unit_price)}</td><td className="text-right">{usd(l.amount)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {ex.notes && <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="font-medium">AI notes: </span>{ex.notes}</div>}
    </div>
  );
}

function Conf({ v }: { v: number }) {
  const color = v >= 0.9 ? "bg-emerald-500" : v >= 0.7 ? "bg-amber-400" : "bg-rose-500";
  return (
    <div className="flex items-center gap-1.5" title="AI read confidence">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${color}`} style={{ width: `${v * 100}%` }} /></div>
      <span className="w-8 text-right text-[11px] text-muted">{Math.round(v * 100)}%</span>
    </div>
  );
}
