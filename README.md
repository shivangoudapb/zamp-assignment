# Invoice Agent — PDF in, reasoned decision out

An automated accounts-payable process: upload a vendor invoice (PDF or scan) and it is read by AI,
checked against the vendor master and purchase orders, and given a decision —
**Approve**, **Hold** (human review) or **Reject** — with every reason visible.

Built for the Zamp AI Solutions Associate case study (PS-1).

## How it works

```
Upload ─▶ 1 Ingest ─▶ 2 Extract (AI) ─▶ 3 Validate ─▶ 4 Vendor ─▶ 5 PO match ─▶ 6 Amount & duplicates ─▶ 7 Decide
```

| Stage | What it does |
|---|---|
| Ingest | Stores the original, fingerprints it (SHA-256), detects if it has a text layer or is an image-only scan |
| Extract | Gemini reads the document into a strict JSON schema with a confidence score per key field. **The only AI step.** |
| Validate | Required fields, line items → subtotal → total arithmetic, date sanity, low-confidence fields |
| Vendor | Fuzzy-matches the printed name (or tax ID) to the vendor master; blocked vendors; bank account on invoice vs on file |
| PO match | Uses the printed PO (tolerates `PO 1002` vs `PO-1002`); if none, scores the vendor's open POs by line-item overlap and remaining balance |
| Amount & duplicates | Invoice vs **remaining** PO balance (after earlier approved invoices) with 2% tolerance; duplicate by file hash, normalised invoice number, and same amount within 7 days |
| Decide | Any reject → **Reject**; any hold → **Hold**; else **Approve**. Plain-English summary + next action |

**Design principle — AI reads, rules decide.** The model never makes the payment decision. All decision
logic is deterministic code in [`lib/rules.ts`](lib/rules.ts), so every outcome is explainable and repeatable.
If anything fails (AI outage, unreadable file), the invoice is routed to manual review — never silently approved.

## Demo scenarios (`public/samples/`)

| Invoice | Scenario | Outcome |
|---|---|---|
| `happy-acme.pdf` | Clean invoice, explicit PO, 0.8% over PO for freight | ✅ Approve (within tolerance) |
| `split-globex.pdf` | 2nd invoice on a PO already 60% billed — $4,800 vs $4,000 remaining | 🟡 Hold — PO overrun |
| `duplicate-initech.pdf` | Approved invoice `INV-0457` re-sent by vendor's new system as `INV0457` | ❌ Reject — duplicate |
| `scanned-northwind.pdf` | Image-only scan, trade name not legal name, no PO printed | 🟡 Hold — PO inferred, requester confirms |
| `fraud-stark.pdf` | Known vendor + valid PO, but "our bank details have changed" | 🟡 Hold — possible payment fraud |

Held invoices can be approved or rejected by a reviewer in the UI; approvals then count against the PO balance.

## Configurable rules (`/rules`)

Every threshold and rule outcome is editable without code:

- **Thresholds:** over-billing tolerance %, minimum AI read confidence, vendor-name match %, near-duplicate window, max invoice age.
- **Optional controls:** an approval limit (invoices above $X always need sign-off) and auto-accepting inferred POs above a confidence %.
- **Outcome per rule:** Reject / Hold / Flag only. Fraud, duplicate and vendor-trust rules cannot be set to flag-only (enforced server-side).
- Each run stores a **snapshot of the rules it was decided under**, so changing policy never rewrites past decisions.

## Assumptions

- PO amounts are total committed value incl. tax; tolerance is 2% of PO value.
- PO balance consumption counts only approved invoices (system- or reviewer-approved).
- No PO, no auto-pay: an inferred PO is always confirmed by a human, however confident the match.
- Bank details are only ever changed through the vendor master, never from an invoice.
- Single currency (USD); single buyer entity.

## Stack

Next.js 15 (App Router, TypeScript, Tailwind) · Gemini (`@google/genai`, structured JSON output) ·
Supabase (Postgres + Storage) · deployed on Vercel. The live run view polls the run's stage rows every second.

## Run locally

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill in the Gemini key and Supabase URL + **secret** key.
3. In Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql) (existing installs: also run `supabase/migrations/002_settings.sql`).
4. `npm run dev`, open http://localhost:3000, go to **Vendors & POs → Reset demo data**.
5. **Process invoice** → pick a demo invoice.

Tests: `npx tsx scripts/test-rules.ts` (14 offline rule scenarios, incl. rule-config variants) and
`bash scripts/run-samples.sh` (end-to-end against the running app).
Regenerate sample PDFs: `python scripts/make_invoices.py`.

## What I'd build next

Email inbox ingestion · multi-currency · per-vendor tolerance · line-level 3-way match against goods receipts ·
vendor follow-up emails drafted automatically · reviewer roles and audit export.
