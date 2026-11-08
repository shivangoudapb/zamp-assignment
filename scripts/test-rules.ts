// Offline test of the decision engine — no API keys needed.
// Feeds hand-written extractions (what Gemini should return for each sample PDF) through the rules.
// Run:  npx tsx scripts/test-rules.ts

import { PURCHASE_ORDERS, VENDORS, seedRunRows } from "../lib/seed";
import { checkAmountsAndDuplicates, checkVendor, decide, matchPo, validate, type HistoryRun } from "../lib/rules";
import type { Extraction, Finding, PurchaseOrder, Vendor } from "../lib/types";
import { DEFAULT_CONFIG, sanitizeConfig, type Outcome, type RuleConfig } from "../lib/config";

const base: Extraction = {
  is_invoice: true, document_type: "invoice", vendor_name: null, vendor_tax_id: null, vendor_email: null,
  vendor_bank_account: null, bank_details_changed_notice: false, invoice_number: null, invoice_date: null,
  due_date: null, po_reference: null, currency: "USD", line_items: [], subtotal: null, tax_amount: null,
  other_charges: null, total: null, tax_inclusive: false, is_scanned_image: false,
  confidence: { vendor_name: 0.98, invoice_number: 0.98, invoice_date: 0.97, total: 0.99, po_reference: 0.95 }, notes: null,
};
const li = (description: string, quantity: number, unit_price: number) => ({ description, quantity, unit_price, amount: quantity * unit_price });

const cases: { name: string; expect: string; ex: Extraction }[] = [
  {
    name: "happy-acme", expect: "APPROVE",
    ex: { ...base, vendor_name: "ACME INDUSTRIAL SUPPLIES INC.", vendor_tax_id: "84-2210457", vendor_bank_account: "****4821",
      invoice_number: "INV-0512", invoice_date: "2026-11-06", due_date: "2026-12-06", po_reference: "PO-1001",
      line_items: [li("Safety helmets, ANSI Type I", 200, 22.5), li("Hi-vis safety vests, Class 2", 250, 9), li("Steel-toe work boots", 40, 62.5)],
      subtotal: 9250, tax_amount: 740, other_charges: 90, total: 10080 },
  },
  {
    name: "split-globex", expect: "HOLD",
    ex: { ...base, vendor_name: "Globex Logistics LLC", vendor_tax_id: "46-3381902", vendor_bank_account: "ending 7730",
      invoice_number: "GLX-2231", invoice_date: "2026-11-05", po_reference: "PO 1002",
      line_items: [li("Warehousing - pallet storage, November", 1, 2000), li("LTL freight - outbound, 6 shipments", 1, 2300), li("Handling & cross-dock fees", 1, 500)],
      subtotal: 4800, tax_amount: 0, total: 4800 },
  },
  {
    name: "duplicate-initech", expect: "REJECT",
    ex: { ...base, vendor_name: "Initech Software Solutions", vendor_tax_id: "91-1876543", vendor_bank_account: "ending 1190",
      invoice_number: "INV0457", invoice_date: "2026-11-02", po_reference: "PO-1003", tax_inclusive: true,
      line_items: [li("ERP platform licence - quarterly instalment (1 of 3)", 1, 8000)], subtotal: null, tax_amount: null, total: 8000 },
  },
  {
    name: "scanned-northwind", expect: "HOLD",
    ex: { ...base, vendor_name: "NORTHWIND TRADERS", vendor_tax_id: "27-5543210", vendor_bank_account: "ending 5562",
      invoice_number: "NW-3388", invoice_date: "2026-11-05", po_reference: null, is_scanned_image: true,
      line_items: [li("HP 89A black toner cartridge", 10, 115), li("A4 copy paper 80gsm (box/5 reams)", 20, 28)],
      subtotal: 1710, tax_amount: 119.7, total: 1829.7,
      confidence: { vendor_name: 0.95, invoice_number: 0.9, invoice_date: 0.9, total: 0.93, po_reference: 0.9 } },
  },
  {
    name: "fraud-stark", expect: "HOLD",
    ex: { ...base, vendor_name: "Stark Electrical Contractors Ltd", vendor_bank_account: "0099 1882 9917", bank_details_changed_notice: true,
      invoice_number: "SEC-1140", invoice_date: "2026-11-06", po_reference: "PO-1006",
      line_items: [li("LED high-bay fixtures, 150W", 24, 150)], subtotal: 3600, tax_amount: 0, total: 3600 },
  },
  {
    name: "unknown-vendor (extra)", expect: "REJECT",
    ex: { ...base, vendor_name: "Wayne Consulting Partners", invoice_number: "WCP-77", invoice_date: "2026-11-01",
      line_items: [li("Advisory services", 1, 5000)], subtotal: 5000, tax_amount: 0, total: 5000 },
  },
  {
    name: "bad-math (extra)", expect: "HOLD",
    ex: { ...base, vendor_name: "Acme Industrial Supplies", invoice_number: "INV-0520", invoice_date: "2026-11-06", po_reference: "PO-1001",
      line_items: [li("Safety helmets", 10, 22.5)], subtotal: 225, tax_amount: 18, total: 280 },
  },
];

const vendors = VENDORS as Vendor[];
const pos = PURCHASE_ORDERS as PurchaseOrder[];
const history: HistoryRun[] = seedRunRows().map((r, i) => ({
  id: `seed-${i}`, run_no: i + 1, vendor_id: r.vendor_id, invoice_number: r.invoice_number, invoice_number_norm: r.invoice_number_norm,
  invoice_date: r.invoice_date, po_number: r.po_number, total: r.total, decision: r.decision as HistoryRun["decision"],
  review_decision: null, file_hash: null, created_at: r.created_at,
}));

// Same invoices under modified rule settings — proves the Rules page actually changes outcomes.
const byName = (n: string) => cases.find((c) => c.name === n)!.ex;
const withOutcome = (code: string, o: Outcome): RuleConfig => ({ ...DEFAULT_CONFIG, outcomes: { ...DEFAULT_CONFIG.outcomes, [code]: o } });
const variants: { name: string; expect: string; ex: Extraction; cfg: RuleConfig }[] = [
  { name: "split-globex @ 25% tolerance", expect: "APPROVE", ex: byName("split-globex"), cfg: { ...DEFAULT_CONFIG, tolerancePct: 25 } },
  { name: "split-globex, overrun = reject", expect: "REJECT", ex: byName("split-globex"), cfg: withOutcome("PO_OVERRUN", "reject") },
  { name: "fraud-stark, bank mismatch = reject", expect: "REJECT", ex: byName("fraud-stark"), cfg: withOutcome("BANK_MISMATCH", "reject") },
  { name: "happy-acme over $5,000 approval limit", expect: "HOLD", ex: byName("happy-acme"), cfg: { ...DEFAULT_CONFIG, approvalLimit: 5000 } },
  { name: "scanned-northwind, auto-accept PO ≥ 90%", expect: "APPROVE", ex: byName("scanned-northwind"), cfg: { ...DEFAULT_CONFIG, inferredPoAutoAcceptPct: 90 } },
  { name: "bad-math, totals mismatch = flag only", expect: "APPROVE", ex: byName("bad-math (extra)"), cfg: withOutcome("TOTAL_MISMATCH", "info") },
  { name: "sanitize: unsafe flag-only on duplicate ignored", expect: "REJECT", ex: byName("duplicate-initech"), cfg: sanitizeConfig({ outcomes: { DUPLICATE_INVOICE: "info" } }) },
];

let failures = 0;
const all_cases = [...cases.map((c) => ({ ...c, cfg: DEFAULT_CONFIG })), ...variants];
for (const c of all_cases) {
  const cfg = c.cfg;
  const runId = `test-${c.name}`;
  const all: Finding[] = [];
  const v = validate(c.ex, cfg, new Date("2026-11-08"));
  all.push(...v.findings);
  const vr = checkVendor(c.ex, vendors, cfg);
  all.push(...vr.findings);
  const pr = matchPo(c.ex, vr.vendor, pos, history, runId, cfg);
  all.push(...pr.findings);
  const ck = checkAmountsAndDuplicates(c.ex, vr.vendor, pr.po, history, runId, `hash-${c.name}`, cfg);
  all.push(...ck.findings);
  const d = decide(all, { vendorName: vr.vendor?.name ?? c.ex.vendor_name, invoiceNumber: c.ex.invoice_number, total: c.ex.total, po: pr.po?.po_number });

  const ok = d.decision === c.expect;
  if (!ok) failures++;
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${c.name}  →  ${d.decision} (expected ${c.expect})`);
  console.log(`  ${d.summary}`);
  for (const x of all.filter((x) => x.severity !== "pass")) console.log(`   [${x.severity}] ${x.code}: ${x.message}`);
  console.log(`  next: ${d.next_action}`);
}
console.log(`\n${all_cases.length - failures}/${all_cases.length} scenarios behave as expected`);
process.exit(failures ? 1 : 0);
