// Demo reference data. /api/reset wipes runs and reloads exactly this,
// so every demo starts from the same known state.

export const VENDORS = [
  { id: "V001", name: "Acme Industrial Supplies Inc.", aliases: ["Acme Industrial", "Acme Supplies"], tax_id: "84-2210457", email: "billing@acme-industrial.com", bank_last4: "4821", status: "approved" },
  { id: "V002", name: "Globex Logistics LLC", aliases: ["Globex", "Globex Freight"], tax_id: "46-3381902", email: "ar@globexlogistics.com", bank_last4: "7730", status: "approved" },
  { id: "V003", name: "Initech Software Solutions", aliases: ["Initech"], tax_id: "91-1876543", email: "invoices@initech.io", bank_last4: "1190", status: "approved" },
  { id: "V004", name: "Northwind Office Supplies Co.", aliases: ["Northwind Traders", "Northwind"], tax_id: "27-5543210", email: "accounts@northwind-office.com", bank_last4: "5562", status: "approved" },
  { id: "V005", name: "Umbrella Facilities Group", aliases: ["Umbrella Facilities"], tax_id: "33-9081726", email: "billing@umbrellafg.com", bank_last4: "6604", status: "blocked" },
  { id: "V006", name: "Stark Electrical Contractors", aliases: ["Stark Electrical"], tax_id: "58-4412098", email: "accounts@starkelectrical.com", bank_last4: "3308", status: "approved" },
];

export const PURCHASE_ORDERS = [
  {
    po_number: "PO-1001", vendor_id: "V001", description: "PPE restock — Plant 2", amount: 10000, currency: "USD", status: "open",
    line_items: [
      { description: "Safety helmets, ANSI Type I", quantity: 200, unit_price: 22.5 },
      { description: "Hi-vis safety vests, Class 2", quantity: 250, unit_price: 9.0 },
      { description: "Steel-toe work boots", quantity: 40, unit_price: 62.5 },
    ],
  },
  {
    po_number: "PO-1002", vendor_id: "V002", description: "Q4 freight & warehousing", amount: 10000, currency: "USD", status: "open",
    line_items: [
      { description: "Warehousing — pallet storage (monthly)", quantity: 3, unit_price: 2000 },
      { description: "LTL freight — outbound", quantity: 1, unit_price: 3000 },
      { description: "Handling & cross-dock", quantity: 1, unit_price: 1000 },
    ],
  },
  {
    po_number: "PO-1003", vendor_id: "V003", description: "ERP licence — FY26 (3 instalments)", amount: 24000, currency: "USD", status: "open",
    line_items: [{ description: "ERP platform licence — quarterly instalment", quantity: 3, unit_price: 8000 }],
  },
  {
    po_number: "PO-1004", vendor_id: "V004", description: "General office supplies — Q4", amount: 3000, currency: "USD", status: "open",
    line_items: [
      { description: "Stationery assortment", quantity: 1, unit_price: 1200 },
      { description: "Office chairs, ergonomic", quantity: 6, unit_price: 300 },
    ],
  },
  {
    po_number: "PO-1005", vendor_id: "V004", description: "Printer toner & copy paper", amount: 1850, currency: "USD", status: "open",
    line_items: [
      { description: "Toner cartridge, black, HP 89A", quantity: 10, unit_price: 115 },
      { description: "Copy paper A4 80gsm, box of 5 reams", quantity: 25, unit_price: 28 },
    ],
  },
  {
    po_number: "PO-1006", vendor_id: "V006", description: "Warehouse lighting retrofit", amount: 5500, currency: "USD", status: "open",
    line_items: [
      { description: "LED high-bay fixtures, 150W", quantity: 24, unit_price: 150 },
      { description: "Installation labour", quantity: 1, unit_price: 1900 },
    ],
  },
];

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

type SeedRun = {
  vendor_id: string; vendor_name: string; invoice_number: string; invoice_date: string;
  po_number: string | null; total: number; decision: "APPROVE" | "HOLD" | "REJECT";
  summary: string; reasons: { code: string; severity: string; stage: string; message: string }[];
  age_days: number;
};

// Historical runs (no file attached). They give the dashboard some history and
// they are what the edge cases collide with:
//  - GLX-2207 already consumed $6,000 of PO-1002  → split-invoice edge case
//  - INV-0457 from Initech was already approved   → duplicate edge case
const SEED_RUNS: SeedRun[] = [
  {
    vendor_id: "V004", vendor_name: "Northwind Office Supplies Co.", invoice_number: "NW-3301", invoice_date: "2026-10-27",
    po_number: "PO-1004", total: 640, decision: "APPROVE", age_days: 12,
    summary: "Approved — matched PO-1004, amount within remaining balance.",
    reasons: [{ code: "PO_MATCH", severity: "pass", stage: "po_match", message: "Explicit PO-1004 matched to vendor." }],
  },
  {
    vendor_id: "V002", vendor_name: "Globex Logistics LLC", invoice_number: "GLX-2207", invoice_date: "2026-10-29",
    po_number: "PO-1002", total: 6000, decision: "APPROVE", age_days: 10,
    summary: "Approved — matched PO-1002, $6,000.00 of $10,000.00 consumed.",
    reasons: [{ code: "PO_MATCH", severity: "pass", stage: "po_match", message: "Explicit PO-1002 matched to vendor." }],
  },
  {
    vendor_id: "V005", vendor_name: "Umbrella Facilities Group", invoice_number: "UFG-881", invoice_date: "2026-10-31",
    po_number: null, total: 1200, decision: "REJECT", age_days: 8,
    summary: "Rejected — vendor is blocked in the vendor master.",
    reasons: [{ code: "VENDOR_BLOCKED", severity: "reject", stage: "vendor", message: "Umbrella Facilities Group is blocked; payments are not allowed." }],
  },
  {
    vendor_id: "V003", vendor_name: "Initech Software Solutions", invoice_number: "INV-0457", invoice_date: "2026-11-02",
    po_number: "PO-1003", total: 8000, decision: "APPROVE", age_days: 5,
    summary: "Approved — matched PO-1003 (instalment 1 of 3).",
    reasons: [{ code: "PO_MATCH", severity: "pass", stage: "po_match", message: "Explicit PO-1003 matched to vendor." }],
  },
  {
    vendor_id: "V006", vendor_name: "Stark Electrical Contractors", invoice_number: "SEC-1102", invoice_date: "2026-11-04",
    po_number: "PO-1006", total: 2000, decision: "HOLD", age_days: 3,
    summary: "On hold — invoice dated before PO approval; needs AP review.",
    reasons: [{ code: "DATE_BEFORE_PO", severity: "hold", stage: "validate", message: "Invoice date precedes PO approval date." }],
  },
];

export function seedRunRows() {
  return SEED_RUNS.map((r) => ({
    source: "seed",
    status: "done",
    file_name: `${r.invoice_number}.pdf (historical)`,
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    invoice_number: r.invoice_number,
    invoice_number_norm: r.invoice_number.toUpperCase().replace(/[^A-Z0-9]/g, ""),
    invoice_date: r.invoice_date,
    po_number: r.po_number,
    po_match_method: r.po_number ? "explicit" : "none",
    currency: "USD",
    total: r.total,
    decision: r.decision,
    summary: r.summary,
    reasons: r.reasons,
    created_at: daysAgo(r.age_days),
    finished_at: daysAgo(r.age_days),
    duration_ms: 6000 + Math.round(Math.random() * 4000),
  }));
}
