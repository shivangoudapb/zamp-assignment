"use client";
import { useEffect, useMemo, useState } from "react";
import { Lock, LoaderCircle, Save, Undo2 } from "lucide-react";
import { Card, timeAgo } from "@/components/ui";
import { OUTCOME_LABEL, type Outcome, type RuleConfig, type RuleMeta } from "@/lib/config";
import { STAGES } from "@/lib/types";

type Payload = { config: RuleConfig; defaults: RuleConfig; rules: RuleMeta[]; persisted: boolean; updated_at: string | null; error?: string };

const OUTCOME_STYLE: Record<Outcome, string> = {
  reject: "bg-rose-600 text-white",
  hold: "bg-amber-500 text-white",
  info: "bg-slate-600 text-white",
};

export default function RulesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [cfg, setCfg] = useState<RuleConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const res = await fetch("/api/settings", { cache: "no-store" });
    const json: Payload = await res.json();
    setData(json);
    setCfg(json.config);
  }
  useEffect(() => { load(); }, []);

  const dirty = useMemo(() => !!data && !!cfg && JSON.stringify(cfg) !== JSON.stringify(data.config), [cfg, data]);

  async function save(reset = false) {
    if (reset && !confirm("Restore all rules to their default settings?")) return;
    setBusy(true); setMsg(null);
    const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(reset ? { reset: true } : { config: cfg }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: json.error ?? "Save failed" });
    setMsg({ ok: true, text: reset ? "Defaults restored." : "Saved — new invoices will use these rules." });
    load();
  }

  if (!data || !cfg) return <div className="flex justify-center py-24"><LoaderCircle className="animate-spin text-muted" /></div>;
  const set = (patch: Partial<RuleConfig>) => setCfg((c) => (c ? { ...c, ...patch } : c));
  const setOutcome = (code: string, o: Outcome) => setCfg((c) => (c ? { ...c, outcomes: { ...c.outcomes, [code]: o } } : c));
  const d = data.defaults;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Rules</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            The policy the decision engine applies. Changes affect new invoices only — every past run keeps a snapshot of the rules it was decided under.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.updated_at && <span className="text-xs text-muted">Last saved {timeAgo(data.updated_at)}</span>}
          <button onClick={() => save(true)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
            <Undo2 size={15} /> Restore defaults
          </button>
        </div>
      </div>

      {!data.persisted && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Rules can&apos;t be saved yet: the <code>settings</code> table is missing. Run <code>supabase/migrations/002_settings.sql</code> in the Supabase SQL editor. Defaults are in use meanwhile.
        </div>
      )}
      {msg && <div className={`rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{msg.text}</div>}

      {/* Thresholds */}
      <Card className="p-5">
        <h2 className="font-semibold">Thresholds</h2>
        <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
          <NumberField label="Over-billing tolerance" unit="% of PO value" value={cfg.tolerancePct} def={d.tolerancePct} min={0} max={50} step={0.5}
            help="How far an invoice may exceed the remaining PO balance before it's flagged (freight, rounding)." onChange={(v) => set({ tolerancePct: v })} />
          <NumberField label="Minimum AI read confidence" unit="%" value={Math.round(cfg.minFieldConfidence * 100)} def={Math.round(d.minFieldConfidence * 100)} min={0} max={100} step={5}
            help="Key fields read below this confidence go to a human." onChange={(v) => set({ minFieldConfidence: v / 100 })} />
          <NumberField label="Vendor name match" unit="% similarity" value={Math.round(cfg.vendorMatchThreshold * 100)} def={Math.round(d.vendorMatchThreshold * 100)} min={50} max={100} step={1}
            help="How closely the printed name must match the vendor master (a tax ID match always counts)." onChange={(v) => set({ vendorMatchThreshold: v / 100 })} />
          <NumberField label="Near-duplicate window" unit="days" value={cfg.nearDuplicateDays} def={d.nearDuplicateDays} min={0} max={90} step={1}
            help="Same vendor and same amount within this many days counts as a possible duplicate. 0 turns it off." onChange={(v) => set({ nearDuplicateDays: v })} />
          <NumberField label="Maximum invoice age" unit="days" value={cfg.maxInvoiceAgeDays} def={d.maxInvoiceAgeDays} min={1} max={3650} step={1}
            help="Older invoices may already have been paid outside the system." onChange={(v) => set({ maxInvoiceAgeDays: v })} />
          <OptionalField label="Approval limit" unit="USD" value={cfg.approvalLimit} placeholder={5000} min={0} max={1e9} step={500}
            help="Invoices above this amount always need human sign-off, even if every check passes."
            onLabel="Require sign-off above a limit" onChange={(v) => set({ approvalLimit: v })} />
          <OptionalField label="Auto-accept inferred PO" unit="% confidence" value={cfg.inferredPoAutoAcceptPct} placeholder={95} min={50} max={100} step={1}
            help="When no PO is printed, accept the suggested PO automatically at or above this confidence. Off = a human always confirms."
            onLabel="Auto-accept strong PO matches" onChange={(v) => set({ inferredPoAutoAcceptPct: v })} />
        </div>
      </Card>

      {/* Rule outcomes */}
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">What each rule does when it fires</h2>
          <div className="flex gap-3 text-xs text-muted">
            <span><b className="text-rose-700">Reject</b> — don&apos;t pay</span>
            <span><b className="text-amber-700">Hold</b> — human decides</span>
            <span><b className="text-slate-700">Flag only</b> — noted, doesn&apos;t block</span>
          </div>
        </div>
        <div className="mt-4 space-y-6">
          {STAGES.filter((s) => data.rules.some((r) => r.stage === s.key)).map((s) => (
            <div key={s.key}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</div>
              <div className="divide-y divide-line rounded-lg border border-line">
                {data.rules.filter((r) => r.stage === s.key).map((r) => {
                  const current = cfg.outcomes[r.code];
                  const changed = current !== r.default;
                  return (
                    <div key={r.code} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {r.label}
                          {changed && <span className="rounded bg-blue-50 px-1.5 text-[10px] font-medium text-brand">changed</span>}
                        </div>
                        <div className="text-xs text-muted">
                          {r.why}
                          {!r.allowed.includes("info") && <span className="ml-1 inline-flex items-center gap-0.5"><Lock size={10} /> can&apos;t be flag-only</span>}
                        </div>
                      </div>
                      <div className="flex overflow-hidden rounded-md border border-line text-xs">
                        {(["reject", "hold", "info"] as Outcome[]).map((o) => {
                          const allowed = r.allowed.includes(o);
                          return (
                            <button key={o} disabled={!allowed} onClick={() => setOutcome(r.code, o)}
                              title={allowed ? undefined : "Not allowed for this rule"}
                              className={`px-2.5 py-1 font-medium ${current === o ? OUTCOME_STYLE[o] : allowed ? "bg-white text-slate-600 hover:bg-slate-50" : "cursor-not-allowed bg-slate-50 text-slate-300"}`}>
                              {OUTCOME_LABEL[o]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Sticky save bar */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <span className="text-sm">You have unsaved changes.</span>
            <div className="flex gap-2">
              <button onClick={() => setCfg(data.config)} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-slate-50">Discard</button>
              <button onClick={() => save(false)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />} Save rules
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({ label, unit, value, def, min, max, step, help, onChange }: {
  label: string; unit: string; value: number; def: number; min: number; max: number; step: number; help: string; onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (t: string) => {
    const n = Number(t);
    if (t.trim() === "" || !Number.isFinite(n)) return setText(String(value));
    const c = Math.min(max, Math.max(min, n));
    setText(String(c));
    onChange(c);
  };
  return (
    <label className="block">
      <div className="flex items-center gap-2 text-sm font-medium">
        {label}
        {value !== def && <span className="rounded bg-blue-50 px-1.5 text-[10px] font-medium text-brand">default {def}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <input type="number" value={text} min={min} max={max} step={step}
          onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n); }}
          onBlur={(e) => commit(e.target.value)}
          className="w-28 rounded-md border border-line px-3 py-1.5 text-sm tabular-nums outline-none focus:border-brand" />
        <span className="text-sm text-muted">{unit}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{help}</p>
    </label>
  );
}

function OptionalField({ label, unit, value, placeholder, min, max, step, help, onLabel, onChange }: {
  label: string; unit: string; value: number | null; placeholder: number; min: number; max: number; step: number; help: string; onLabel: string; onChange: (v: number | null) => void;
}) {
  const on = value != null;
  return (
    <div>
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? placeholder : null)} className="h-4 w-4 accent-[var(--color-brand)]" />
          {onLabel}
        </label>
        {on && (
          <span className="flex items-center gap-2">
            <input type="number" value={value} min={min} max={max} step={step}
              onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }}
              className="w-28 rounded-md border border-line px-3 py-1.5 text-sm tabular-nums outline-none focus:border-brand" />
            <span className="text-sm text-muted">{unit}</span>
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{help}</p>
    </div>
  );
}
