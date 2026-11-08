"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, LoaderCircle, ScanLine, Upload } from "lucide-react";
import { Card } from "@/components/ui";

const SAMPLES = [
  { file: "happy-acme.pdf", title: "Happy path", tag: "Acme · PO-1001", desc: "Clean digital invoice, explicit PO, 0.8% over PO for freight — within tolerance.", expect: "Approve" },
  { file: "split-globex.pdf", title: "Split PO overrun", tag: "Globex · PO-1002", desc: "Second invoice against a PO already 60% billed. Pushes past the remaining balance.", expect: "Hold" },
  { file: "duplicate-initech.pdf", title: "Re-sent duplicate", tag: "Initech · INV0457", desc: "Vendor's new billing system re-sends an approved invoice with a reformatted number.", expect: "Reject" },
  { file: "scanned-northwind.pdf", title: "Scanned, no PO", tag: "Northwind · scan", desc: "Image-only scan, trade name instead of legal name, no PO number printed.", expect: "Hold" },
  { file: "fraud-stark.pdf", title: "Bank details changed", tag: "Stark · PO-1006", desc: "Valid vendor and PO, but the invoice asks to pay a new bank account.", expect: "Hold" },
];

const EXPECT_STYLE: Record<string, string> = {
  Approve: "text-emerald-700 bg-emerald-50", Hold: "text-amber-700 bg-amber-50", Reject: "text-rose-700 bg-rose-50",
};

export default function NewRun() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function submit(file: File, key: string) {
    setBusy(key);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/runs", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      router.push(`/runs/${json.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  async function runSample(name: string) {
    setBusy(name);
    const blob = await (await fetch(`/samples/${name}`)).blob();
    await submit(new File([blob], name, { type: "application/pdf" }), name);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Process an invoice</h1>
        <p className="mt-1 text-sm text-muted">Upload a vendor invoice (PDF or image). It is read by AI, checked against the vendor master and purchase orders, and given a reasoned decision.</p>
      </div>

      <Card>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) submit(f, "upload"); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${drag ? "border-brand bg-brand-soft" : "border-line hover:border-slate-300"}`}
        >
          {busy === "upload" ? <LoaderCircle className="animate-spin text-brand" size={28} /> : <Upload className="text-muted" size={28} />}
          <div className="font-medium">{busy === "upload" ? "Uploading…" : "Drop an invoice here, or click to choose"}</div>
          <div className="text-xs text-muted">PDF, PNG or JPG · up to 4 MB</div>
          <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" disabled={!!busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) submit(f, "upload"); }} />
        </label>
      </Card>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Demo invoices</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {SAMPLES.map((s) => (
            <Card key={s.file} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-medium">
                  {s.file.startsWith("scanned") ? <ScanLine size={16} className="text-muted" /> : <FileText size={16} className="text-muted" />}
                  {s.title}
                </div>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${EXPECT_STYLE[s.expect]}`}>expect: {s.expect}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted">{s.tag}</div>
              <p className="mt-2 flex-1 text-sm text-slate-600">{s.desc}</p>
              <div className="mt-3 flex items-center gap-3">
                <button onClick={() => runSample(s.file)} disabled={!!busy}
                  className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                  {busy === s.file && <LoaderCircle size={14} className="animate-spin" />} Run
                </button>
                <a href={`/samples/${s.file}`} target="_blank" className="text-sm text-muted hover:text-ink">View PDF</a>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
