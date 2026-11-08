// Rule configuration — editable from the Rules page, stored in the `settings` table.
// Every run records a snapshot of the config it was decided under (audit trail).

import type { StageKey } from "./types";

export type Outcome = "reject" | "hold" | "info";

export type RuleConfig = {
  tolerancePct: number; // % of PO value an invoice may exceed the remaining balance by
  minFieldConfidence: number; // 0..1 — below this, a human checks the field
  vendorMatchThreshold: number; // 0..1 — fuzzy name similarity needed to accept a vendor match
  nearDuplicateDays: number; // same vendor + amount within N days = possible duplicate
  maxInvoiceAgeDays: number; // older invoices are flagged
  approvalLimit: number | null; // invoices above this amount always need a human (null = off)
  inferredPoAutoAcceptPct: number | null; // auto-accept an inferred PO at/above this confidence % (null = never)
  outcomes: Record<string, Outcome>; // what each rule does when it fires
};

export type RuleMeta = { code: string; label: string; stage: StageKey; why: string; allowed: Outcome[]; default: Outcome };

// Rules whose outcome can be chosen. "info" = flag only (shown, does not block payment).
// Fraud/duplicate/vendor-trust rules deliberately cannot be downgraded to flag-only.
export const RULES: RuleMeta[] = [
  { code: "NOT_AN_INVOICE", stage: "validate", label: "Document is not an invoice", why: "Quotes, statements and receipts are not payable.", allowed: ["reject", "hold"], default: "reject" },
  { code: "MISSING_FIELD", stage: "validate", label: "Required field missing", why: "Invoice number, vendor, total or date not found.", allowed: ["reject", "hold"], default: "hold" },
  { code: "TOTAL_MISMATCH", stage: "validate", label: "Totals don't reconcile", why: "Subtotal + tax + charges ≠ invoice total.", allowed: ["reject", "hold", "info"], default: "hold" },
  { code: "LINES_MISMATCH", stage: "validate", label: "Line items don't add up", why: "Sum of line items ≠ stated subtotal.", allowed: ["reject", "hold", "info"], default: "hold" },
  { code: "LOW_CONFIDENCE", stage: "validate", label: "Low AI read confidence", why: "A key field was hard to read.", allowed: ["hold", "info"], default: "hold" },
  { code: "FUTURE_DATE", stage: "validate", label: "Invoice dated in the future", why: "Often a typo, sometimes pre-billing.", allowed: ["reject", "hold", "info"], default: "hold" },
  { code: "STALE_INVOICE", stage: "validate", label: "Invoice older than max age", why: "May already have been paid outside the system.", allowed: ["reject", "hold", "info"], default: "hold" },
  { code: "BAD_DATE", stage: "validate", label: "Unreadable invoice date", why: "Date could not be parsed.", allowed: ["hold", "info"], default: "hold" },
  { code: "VENDOR_UNKNOWN", stage: "vendor", label: "Vendor not in vendor master", why: "Unvetted vendors must be onboarded first.", allowed: ["reject", "hold"], default: "reject" },
  { code: "VENDOR_BLOCKED", stage: "vendor", label: "Vendor is blocked", why: "Procurement has stopped payments to this vendor.", allowed: ["reject", "hold"], default: "reject" },
  { code: "BANK_MISMATCH", stage: "vendor", label: "Bank account ≠ vendor master", why: "Classic payment-fraud pattern.", allowed: ["reject", "hold"], default: "hold" },
  { code: "BANK_CHANGE_NOTICE", stage: "vendor", label: "Invoice announces new bank details", why: "Bank changes must go through vendor-master update.", allowed: ["reject", "hold"], default: "hold" },
  { code: "TAX_ID_MISMATCH", stage: "vendor", label: "Tax ID ≠ vendor master", why: "Possible wrong entity or impersonation.", allowed: ["reject", "hold", "info"], default: "hold" },
  { code: "PO_NOT_FOUND", stage: "po_match", label: "Referenced PO doesn't exist", why: "Wrong or fabricated PO number.", allowed: ["reject", "hold"], default: "hold" },
  { code: "PO_VENDOR_MISMATCH", stage: "po_match", label: "PO belongs to another vendor", why: "Invoice billed against someone else's PO.", allowed: ["reject", "hold"], default: "hold" },
  { code: "PO_CLOSED", stage: "po_match", label: "PO is closed", why: "No further spend authorised.", allowed: ["reject", "hold"], default: "hold" },
  { code: "NO_PO", stage: "po_match", label: "No PO and none can be inferred", why: "No PO, no pay.", allowed: ["reject", "hold"], default: "hold" },
  { code: "PO_INFERRED", stage: "po_match", label: "PO inferred (not printed)", why: "Suggested PO needs requester confirmation.", allowed: ["hold", "info"], default: "hold" },
  { code: "PO_OVERRUN", stage: "checks", label: "Exceeds remaining PO balance", why: "Over-billing beyond tolerance.", allowed: ["reject", "hold"], default: "hold" },
  { code: "CURRENCY_MISMATCH", stage: "checks", label: "Currency ≠ PO currency", why: "Amounts not comparable.", allowed: ["reject", "hold"], default: "hold" },
  { code: "DUPLICATE_INVOICE", stage: "checks", label: "Duplicate invoice number", why: "Same vendor + same normalised invoice number.", allowed: ["reject", "hold"], default: "reject" },
  { code: "DUPLICATE_FILE", stage: "checks", label: "Exact same file re-submitted", why: "Identical file fingerprint.", allowed: ["reject", "hold"], default: "reject" },
  { code: "POSSIBLE_DUPLICATE", stage: "checks", label: "Same vendor + amount, new number", why: "Duplicate under a different invoice number.", allowed: ["reject", "hold", "info"], default: "hold" },
  { code: "OVER_APPROVAL_LIMIT", stage: "checks", label: "Above approval limit", why: "High-value invoices need human sign-off.", allowed: ["hold", "info"], default: "hold" },
];

export const DEFAULT_CONFIG: RuleConfig = {
  tolerancePct: 2,
  minFieldConfidence: 0.7,
  vendorMatchThreshold: 0.85,
  nearDuplicateDays: 7,
  maxInvoiceAgeDays: 180,
  approvalLimit: null,
  inferredPoAutoAcceptPct: null,
  outcomes: Object.fromEntries(RULES.map((r) => [r.code, r.default])),
};

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
};
const optional = (n: unknown, lo: number, hi: number) =>
  n === null || n === undefined || n === "" ? null : clamp(n, lo, hi, lo);

/** Merge untrusted input over defaults, clamping every value into a safe range. */
export function sanitizeConfig(input: unknown): RuleConfig {
  const c = (input && typeof input === "object" ? input : {}) as Partial<RuleConfig>;
  const outcomes: Record<string, Outcome> = { ...DEFAULT_CONFIG.outcomes };
  for (const r of RULES) {
    const v = c.outcomes?.[r.code];
    if (v && r.allowed.includes(v)) outcomes[r.code] = v;
  }
  return {
    tolerancePct: clamp(c.tolerancePct, 0, 50, DEFAULT_CONFIG.tolerancePct),
    minFieldConfidence: clamp(c.minFieldConfidence, 0, 1, DEFAULT_CONFIG.minFieldConfidence),
    vendorMatchThreshold: clamp(c.vendorMatchThreshold, 0.5, 1, DEFAULT_CONFIG.vendorMatchThreshold),
    nearDuplicateDays: Math.round(clamp(c.nearDuplicateDays, 0, 90, DEFAULT_CONFIG.nearDuplicateDays)),
    maxInvoiceAgeDays: Math.round(clamp(c.maxInvoiceAgeDays, 1, 3650, DEFAULT_CONFIG.maxInvoiceAgeDays)),
    approvalLimit: optional(c.approvalLimit, 0, 1e9),
    inferredPoAutoAcceptPct: optional(c.inferredPoAutoAcceptPct, 50, 100),
    outcomes,
  };
}

export const OUTCOME_LABEL: Record<Outcome, string> = { reject: "Reject", hold: "Hold", info: "Flag only" };
