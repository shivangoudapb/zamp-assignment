"use client";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Card, usd } from "@/components/ui";
import type { RuleConfig } from "@/lib/config";

type Vendor = { id: string; name: string; aliases: string[]; tax_id: string; email: string; bank_last4: string; status: string };
type PO = { po_number: string; vendor_id: string; description: string; amount: number; billed: number; billed_invoices: string[]; remaining: number; status: string };

export default function DataPage() {
  const [data, setData] = useState<{ vendors: Vendor[]; purchase_orders: PO[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [cfg, setCfg] = useState<RuleConfig | null>(null);

  const load = useCallback(async () => {
    const [ref, set] = await Promise.all([fetch("/api/reference", { cache: "no-store" }), fetch("/api/settings", { cache: "no-store" })]);
    setData(await ref.json());
    setCfg((await set.json()).config);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function reset() {
    if (!confirm("Delete all runs and reload the demo vendors, POs and history?")) return;
    setBusy(true); setMsg(null);
    const res = await fetch("/api/reset", { method: "POST" });
    const json = await res.json();
    setMsg(res.ok ? `Demo data loaded: ${json.vendors} vendors, ${json.purchase_orders} POs, history restored.` : `Reset failed: ${json.error}`);
    setBusy(false);
    load();
  }

  const vName = (id: string) => data?.vendors.find((v) => v.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Vendors &amp; purchase orders</h1>
          <p className="mt-1 text-sm text-muted">The reference data every invoice is checked against. Balances update as invoices are approved.</p>
        </div>
        <button onClick={reset} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <RotateCcw size={15} />} Reset demo data
        </button>
      </div>
      {msg && <div className="rounded-lg border border-line bg-white px-4 py-3 text-sm">{msg}</div>}

      {cfg && (
        <Card className="p-4 text-sm">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Rules in force</div>
            <Link href="/rules" className="text-sm text-brand hover:underline">Edit rules →</Link>
          </div>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-muted sm:grid-cols-2">
            <li>Over-billing tolerance: <b className="text-ink">{cfg.tolerancePct}% of PO value</b></li>
            <li>Minimum AI read confidence: <b className="text-ink">{Math.round(cfg.minFieldConfidence * 100)}%</b></li>
            <li>Vendor name match threshold: <b className="text-ink">{Math.round(cfg.vendorMatchThreshold * 100)}%</b></li>
            <li>Near-duplicate window: <b className="text-ink">{cfg.nearDuplicateDays} days</b></li>
            <li>Invoices with no PO: <b className="text-ink">{cfg.inferredPoAutoAcceptPct != null ? `auto-accept at ≥ ${cfg.inferredPoAutoAcceptPct}%` : "PO suggested, human confirms"}</b></li>
            <li>Approval limit: <b className="text-ink">{cfg.approvalLimit != null ? usd(cfg.approvalLimit) : "none"}</b></li>
          </ul>
        </Card>
      )}

      {!data ? <div className="flex justify-center py-16"><LoaderCircle className="animate-spin text-muted" /></div> : (
        <>
          <Card className="overflow-x-auto">
            <div className="border-b border-line px-4 py-3 font-semibold">Purchase orders</div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">PO</th><th className="px-4 py-2 font-medium">Vendor</th><th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 text-right font-medium">Value</th><th className="px-4 py-2 font-medium">Consumed</th><th className="px-4 py-2 text-right font-medium">Remaining</th>
              </tr></thead>
              <tbody>{data.purchase_orders.map((p) => (
                <tr key={p.po_number} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium">{p.po_number}</td>
                  <td className="px-4 py-2.5">{vName(p.vendor_id)}</td>
                  <td className="px-4 py-2.5 text-muted">{p.description}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{usd(p.amount)}</td>
                  <td className="w-48 px-4 py-2.5">
                    <div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (p.billed / p.amount) * 100)}%` }} /></div>
                    <div className="mt-1 text-[11px] text-muted">{p.billed_invoices.length ? p.billed_invoices.join(", ") : "nothing billed"}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{usd(p.remaining)}</td>
                </tr>
              ))}</tbody>
            </table>
          </Card>

          <Card className="overflow-x-auto">
            <div className="border-b border-line px-4 py-3 font-semibold">Vendor master</div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">ID</th><th className="px-4 py-2 font-medium">Name</th><th className="px-4 py-2 font-medium">Also known as</th>
                <th className="px-4 py-2 font-medium">Tax ID</th><th className="px-4 py-2 font-medium">Bank on file</th><th className="px-4 py-2 font-medium">Status</th>
              </tr></thead>
              <tbody>{data.vendors.map((v) => (
                <tr key={v.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 text-muted">{v.id}</td>
                  <td className="px-4 py-2.5 font-medium">{v.name}</td>
                  <td className="px-4 py-2.5 text-muted">{v.aliases.join(", ")}</td>
                  <td className="px-4 py-2.5">{v.tax_id}</td>
                  <td className="px-4 py-2.5">…{v.bank_last4}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{v.status}</span>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {!data.vendors.length && <div className="px-4 py-10 text-center text-sm text-muted">No data yet — click <b>Reset demo data</b> to load it.</div>}
          </Card>
        </>
      )}
    </div>
  );
}
