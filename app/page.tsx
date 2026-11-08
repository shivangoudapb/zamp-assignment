"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { Card, DecisionBadge, timeAgo, usd } from "@/components/ui";
import type { Decision, Finding } from "@/lib/types";

type Row = {
  id: string; run_no: number; source: string; status: string; file_name: string; vendor_name: string | null; invoice_number: string | null;
  po_number: string | null; po_match_method: string | null; total: number | null; decision: Decision | null;
  review_decision: "APPROVE" | "REJECT" | null; summary: string | null; reasons: Finding[]; duration_ms: number | null; created_at: string;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "review", label: "Needs review" },
  { key: "APPROVE", label: "Approved" },
  { key: "HOLD", label: "On hold" },
  { key: "REJECT", label: "Rejected" },
] as const;

const CODE_LABEL: Record<string, string> = {
  PO_OVERRUN: "Exceeds PO balance", PO_INFERRED: "No PO on invoice", DUPLICATE_INVOICE: "Duplicate invoice", DUPLICATE_FILE: "Duplicate file",
  BANK_MISMATCH: "Bank details mismatch", BANK_CHANGE_NOTICE: "Bank change request", VENDOR_UNKNOWN: "Unknown vendor", VENDOR_BLOCKED: "Blocked vendor",
  TOTAL_MISMATCH: "Totals don't reconcile", LINES_MISMATCH: "Line items don't add up", LOW_CONFIDENCE: "Low read confidence", MISSING_FIELD: "Missing field",
  POSSIBLE_DUPLICATE: "Possible duplicate", PO_NOT_FOUND: "PO not found", NO_PO: "No PO", DATE_BEFORE_PO: "Dated before PO", PIPELINE_ERROR: "Processing error",
  NOT_AN_INVOICE: "Not an invoice", OVER_APPROVAL_LIMIT: "Above approval limit", CURRENCY_MISMATCH: "Currency mismatch",
  TAX_ID_MISMATCH: "Tax ID mismatch", PO_CLOSED: "PO closed", PO_VENDOR_MISMATCH: "PO of another vendor", FUTURE_DATE: "Future-dated", STALE_INVOICE: "Stale invoice",
};

export default function Dashboard() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const res = await fetch("/api/runs", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        if (stop) return;
        setRows(json.runs);
        setError(null);
        timer = setTimeout(load, json.runs.some((r: Row) => r.status === "running") ? 2000 : 10000);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, []);

  const eff = (r: Row) => r.review_decision ?? r.decision;

  async function remove(r: Row) {
    if (!confirm(`Delete run #${r.run_no} (${r.vendor_name ?? r.file_name})? The same invoice can then be processed again.`)) return;
    const res = await fetch(`/api/runs/${r.id}`, { method: "DELETE" });
    if (res.ok) setRows((rs) => (rs ?? []).filter((x) => x.id !== r.id));
    else alert((await res.json()).error ?? "Delete failed");
  }

  const stats = useMemo(() => {
    const done = (rows ?? []).filter((r) => r.status !== "running");
    const by = (d: Decision) => done.filter((r) => eff(r) === d);
    const sum = (rs: Row[]) => rs.reduce((s, r) => s + Number(r.total ?? 0), 0);
    const auto = done.filter((r) => r.decision === "APPROVE").length;
    const timed = done.filter((r) => r.source === "upload" && r.duration_ms);
    const reasons = new Map<string, number>();
    for (const r of done) for (const f of r.reasons ?? []) if (f.severity === "hold" || f.severity === "reject") reasons.set(f.code, (reasons.get(f.code) ?? 0) + 1);
    return {
      total: done.length,
      approved: by("APPROVE"), hold: by("HOLD"), rejected: by("REJECT"),
      approvedAmt: sum(by("APPROVE")), holdAmt: sum(by("HOLD")), blockedAmt: sum(by("REJECT")),
      touchless: done.length ? Math.round((auto / done.length) * 100) : 0,
      avgSec: timed.length ? timed.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / timed.length / 1000 : null,
      reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }, [rows]);

  const visible = useMemo(() => (rows ?? []).filter((r) => {
    if (filter === "review" && !(r.decision === "HOLD" && !r.review_decision)) return false;
    if (["APPROVE", "HOLD", "REJECT"].includes(filter) && eff(r) !== filter) return false;
    if (q) {
      const hay = `${r.vendor_name} ${r.invoice_number} ${r.po_number} ${r.file_name} ${r.run_no}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [rows, filter, q]);

  if (error) return (
    <Card className="mx-auto mt-10 max-w-xl p-6 text-sm">
      <div className="font-medium text-rose-700">Could not load runs</div>
      <div className="mt-1 text-muted">{error}</div>
      <div className="mt-3 text-muted">If this is a fresh setup, check <code>.env.local</code>, run <code>supabase/schema.sql</code>, then load demo data from <Link className="text-brand" href="/data">Vendors &amp; POs</Link>.</div>
    </Card>
  );
  if (!rows) return <div className="flex justify-center py-24"><LoaderCircle className="animate-spin text-muted" /></div>;

  const needsReview = rows.filter((r) => r.decision === "HOLD" && !r.review_decision).length;
  const maxReason = stats.reasons[0]?.[1] ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Accounts payable</h1>
          <p className="mt-1 text-sm text-muted">Every invoice processed, the decision taken and why.</p>
        </div>
        {needsReview > 0 && (
          <button onClick={() => setFilter("review")} className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800 hover:bg-amber-200">
            {needsReview} invoice{needsReview > 1 ? "s" : ""} waiting for review →
          </button>
        )}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Invoices processed" value={String(stats.total)} sub={stats.avgSec ? `avg ${stats.avgSec.toFixed(1)}s per invoice` : "—"} />
        <Tile label="Approved" value={usd(stats.approvedAmt)} sub={`${stats.approved.length} invoices`} tone="text-emerald-700" />
        <Tile label="On hold" value={usd(stats.holdAmt)} sub={`${stats.hold.length} invoices`} tone="text-amber-700" />
        <Tile label="Blocked from payment" value={usd(stats.blockedAmt)} sub={`${stats.rejected.length} rejected`} tone="text-rose-700" />
        <Tile label="Touchless rate" value={`${stats.touchless}%`} sub="auto-approved, no human" />
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Runs table */}
        <Card className="overflow-hidden lg:col-span-9">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`rounded-md px-2.5 py-1 text-sm ${filter === f.key ? "bg-ink text-white" : "text-muted hover:bg-slate-100"}`}>{f.label}</button>
            ))}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor, invoice, PO…"
              className="ml-auto w-full rounded-md border border-line px-3 py-1.5 text-sm outline-none focus:border-brand sm:w-60" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Run</th><th className="px-3 py-2 font-medium">Vendor / invoice</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 font-medium">PO</th>
                  <th className="px-3 py-2 font-medium">Decision</th><th className="px-3 py-2 font-medium">Reason</th><th className="px-3 py-2 text-right font-medium">When</th><th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} onClick={() => router.push(`/runs/${r.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2.5 text-muted">#{r.run_no}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{r.vendor_name ?? (r.status === "running" ? "Reading…" : "—")}</div>
                      <div className="text-xs text-muted">{r.invoice_number ?? r.file_name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">{usd(r.total)}</td>
                    <td className="px-3 py-2.5">{r.po_number ?? "—"}{r.po_match_method === "inferred" && <span className="ml-1 text-xs text-muted">(inferred)</span>}</td>
                    <td className="px-3 py-2.5"><DecisionBadge decision={r.decision} review={r.review_decision} status={r.status} /></td>
                    <td className="max-w-xs px-3 py-2.5 text-xs text-muted">
                      <div className="line-clamp-2">{firstReason(r)}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-muted">{timeAgo(r.created_at)}</td>
                    <td className="px-2 py-2.5 text-right">
                      {r.status !== "running" && (
                        <button title="Delete run" onClick={(e) => { e.stopPropagation(); remove(r); }}
                          className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>
                      )}
                    </td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr><td colSpan={8}className="px-3 py-14 text-center text-muted">
                    {rows.length ? "No invoices match this filter." : <>No invoices yet. <Link href="/new" className="inline-flex items-center gap-1 text-brand"><Plus size={14} />Process one</Link> or load demo data in <Link href="/data" className="text-brand">Vendors &amp; POs</Link>.</>}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Exceptions breakdown */}
        <Card className="p-4 lg:col-span-3">
          <div className="text-sm font-semibold">Top exception reasons</div>
          <div className="mt-0.5 text-xs text-muted">Why invoices were held or rejected</div>
          <div className="mt-4 space-y-3">
            {stats.reasons.length ? stats.reasons.map(([code, n]) => (
              <div key={code}>
                <div className="flex justify-between text-xs"><span>{CODE_LABEL[code] ?? code}</span><span className="text-muted">{n}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-500" style={{ width: `${(n / maxReason) * 100}%` }} /></div>
              </div>
            )) : <div className="text-xs text-muted">No exceptions yet.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function firstReason(r: Row) {
  if (r.status === "running") return "Processing…";
  const blocking = (r.reasons ?? []).find((f) => f.severity === "reject") ?? (r.reasons ?? []).find((f) => f.severity === "hold");
  if (r.review_decision) return `Reviewer ${r.review_decision === "APPROVE" ? "approved" : "rejected"}${blocking ? ` · ${blocking.message}` : ""}`;
  return blocking?.message ?? "All checks passed";
}

function Tile({ label, value, sub, tone = "" }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted">{sub}</div>
    </Card>
  );
}
