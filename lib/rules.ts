// All decision logic lives here. Pure functions: (extraction + reference data + rule config) -> findings.
// The AI never decides; it only reads. Every outcome below is traceable to a rule, and what each
// rule does when it fires (reject / hold / flag only) comes from the user-editable RuleConfig.

import type { Decision, Extraction, Finding, PurchaseOrder, StageKey, StepStatus, Vendor } from "./types";
import { descriptionOverlap, last4, normId, normName, round2, similarity, usd } from "./match";
import { DEFAULT_CONFIG, type RuleConfig } from "./config";

export type StageResult = { status: StepStatus; summary: string; detail: Record<string, unknown>; findings: Finding[] };

export type HistoryRun = {
  id: string; run_no: number; vendor_id: string | null; invoice_number: string | null; invoice_number_norm: string | null;
  invoice_date: string | null; po_number: string | null; total: number | null; decision: Decision | null;
  review_decision: "APPROVE" | "REJECT" | null; file_hash: string | null; created_at: string;
};

export const effectiveDecision = (r: Pick<HistoryRun, "decision" | "review_decision">): Decision | null =>
  r.review_decision ?? r.decision;

/** A finding with a fixed severity (pass/info that never blocks). */
const f = (stage: StageKey, severity: Finding["severity"], code: string, message: string): Finding => ({ stage, severity, code, message });

/** A finding from a configurable rule — severity comes from the user's config. */
const rule = (cfg: RuleConfig, stage: StageKey, code: string, message: string): Finding =>
  ({ stage, code, message, severity: cfg.outcomes[code] ?? DEFAULT_CONFIG.outcomes[code] ?? "hold" });

const blocking = (x: Finding) => x.severity === "hold" || x.severity === "reject";

export function statusFrom(findings: Finding[]): StepStatus {
  if (findings.some((x) => x.severity === "reject")) return "failed";
  if (findings.some((x) => x.severity === "hold")) return "warn";
  return "done";
}

const daysBetween = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;

// ------------------------------------------------------------------ VALIDATE
export function validate(ex: Extraction, cfg: RuleConfig = DEFAULT_CONFIG, today = new Date()): StageResult {
  const S: StageKey = "validate";
  const out: Finding[] = [];

  if (!ex.is_invoice) {
    out.push(rule(cfg, S, "NOT_AN_INVOICE", `Document looks like a ${ex.document_type || "non-invoice"}, not an invoice requesting payment.`));
    return { status: statusFrom(out), summary: `Not an invoice (${ex.document_type})`, detail: {}, findings: out };
  }

  const missing = (["vendor_name", "invoice_number", "total", "invoice_date"] as const).filter((k) => ex[k] == null || ex[k] === "");
  for (const k of missing) out.push(rule(cfg, S, "MISSING_FIELD", `Required field missing: ${k.replace("_", " ")}.`));

  // Dates
  if (ex.invoice_date) {
    const d = new Date(ex.invoice_date);
    const ageDays = (today.getTime() - d.getTime()) / 86_400_000;
    if (isNaN(d.getTime())) out.push(rule(cfg, S, "BAD_DATE", `Invoice date "${ex.invoice_date}" could not be parsed.`));
    else if (ageDays < -1) out.push(rule(cfg, S, "FUTURE_DATE", `Invoice is dated in the future (${ex.invoice_date}).`));
    else if (ageDays > cfg.maxInvoiceAgeDays) out.push(rule(cfg, S, "STALE_INVOICE", `Invoice is ${Math.round(ageDays)} days old (limit ${cfg.maxInvoiceAgeDays}).`));
  }

  // Arithmetic: line items -> subtotal -> total
  const lineSum = round2(ex.line_items.reduce((s, l) => s + (l.amount ?? (l.quantity ?? 0) * (l.unit_price ?? 0)), 0));
  const base = ex.subtotal ?? lineSum;
  const tax = ex.tax_inclusive ? 0 : ex.tax_amount ?? 0;
  const expected = round2(base + tax + (ex.other_charges ?? 0));
  const tol = Math.max(0.05, (ex.total ?? 0) * 0.0005);
  const math = { line_sum: lineSum, subtotal: ex.subtotal, tax: ex.tax_amount, other_charges: ex.other_charges, expected_total: expected, stated_total: ex.total };

  if (ex.line_items.length && ex.subtotal != null && Math.abs(lineSum - ex.subtotal) > tol) {
    out.push(rule(cfg, S, "LINES_MISMATCH", `Line items add up to ${usd(lineSum)} but subtotal says ${usd(ex.subtotal)}.`));
  }
  if (ex.total != null && Math.abs(expected - ex.total) > tol) {
    out.push(rule(cfg, S, "TOTAL_MISMATCH", `Subtotal + tax + charges = ${usd(expected)} but invoice total is ${usd(ex.total)}.`));
  } else if (ex.total != null) {
    out.push(f(S, "pass", "MATH_OK", `Arithmetic checks out: ${usd(base)} + tax ${usd(tax)} + charges ${usd(ex.other_charges ?? 0)} = ${usd(ex.total)}.`));
  }

  // Extraction confidence
  const low = Object.entries(ex.confidence).filter(([k, v]) => v < cfg.minFieldConfidence && ex[k as keyof Extraction] != null);
  for (const [k, v] of low) out.push(rule(cfg, S, "LOW_CONFIDENCE", `Low read confidence on ${k.replace("_", " ")} (${Math.round(v * 100)}%, threshold ${Math.round(cfg.minFieldConfidence * 100)}%) — verify against the document.`));

  if (ex.is_scanned_image) out.push(f(S, "info", "SCANNED", "Scanned image — read with vision model; key fields still above confidence threshold."));

  const issues = out.filter(blocking).length;
  return {
    status: statusFrom(out),
    summary: issues ? `${issues} issue${issues > 1 ? "s" : ""} found` : "All required fields present, totals reconcile",
    detail: { math, missing },
    findings: out,
  };
}

// ------------------------------------------------------------------ VENDOR
export function checkVendor(ex: Extraction, vendors: Vendor[], cfg: RuleConfig = DEFAULT_CONFIG): StageResult & { vendor: Vendor | null } {
  const S: StageKey = "vendor";
  const out: Finding[] = [];
  const printed = ex.vendor_name ?? "";

  const scored = vendors
    .map((v) => {
      const nameScore = Math.max(...[v.name, ...v.aliases].map((n) => similarity(normName(printed), normName(n))));
      const taxMatch = !!ex.vendor_tax_id && !!v.tax_id && normId(ex.vendor_tax_id) === normId(v.tax_id);
      return { v, score: taxMatch ? Math.max(nameScore, 0.99) : nameScore, taxMatch };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < cfg.vendorMatchThreshold) {
    out.push(rule(cfg, S, "VENDOR_UNKNOWN", `"${printed || "Unknown"}" is not in the approved vendor master — vendor must be onboarded before payment.`));
    return { status: statusFrom(out), summary: "No matching vendor", detail: { candidates: scored.slice(0, 3).map((s) => ({ name: s.v.name, score: round2(s.score) })) }, findings: out, vendor: null };
  }

  const v = best.v;
  const how = best.taxMatch ? "tax ID match" : `name similarity ${Math.round(best.score * 100)}%`;
  out.push(f(S, "pass", "VENDOR_MATCH", `Matched to ${v.name} (${v.id}) by ${how}.`));

  if (v.status === "blocked") out.push(rule(cfg, S, "VENDOR_BLOCKED", `${v.name} is blocked in the vendor master — payments not allowed.`));

  if (ex.vendor_tax_id && v.tax_id && normId(ex.vendor_tax_id) !== normId(v.tax_id)) {
    out.push(rule(cfg, S, "TAX_ID_MISMATCH", `Tax ID on invoice (${ex.vendor_tax_id}) differs from vendor master (${v.tax_id}).`));
  }

  // Bank-detail fraud check (classic business-email-compromise pattern)
  const invLast4 = last4(ex.vendor_bank_account);
  if (invLast4 && v.bank_last4 && invLast4 !== v.bank_last4) {
    out.push(rule(cfg, S, "BANK_MISMATCH", `Bank account on invoice ends ${invLast4}, but vendor master has ${v.bank_last4}. Possible payment fraud — verify by phone using contact details on file, not the invoice.`));
  } else if (invLast4 && v.bank_last4) {
    out.push(f(S, "pass", "BANK_OK", `Bank account ending ${invLast4} matches vendor master.`));
  }
  if (ex.bank_details_changed_notice) {
    out.push(rule(cfg, S, "BANK_CHANGE_NOTICE", "Invoice announces changed bank details — bank changes must go through vendor-master update, never via an invoice."));
  }

  const status = statusFrom(out);
  return {
    status,
    summary: status === "done" ? `${v.name} · approved vendor` : status === "failed" ? `${v.name} · ${v.status === "blocked" ? "blocked" : "rejected"}` : `${v.name} · needs verification`,
    detail: { vendor_id: v.id, vendor_name: v.name, printed_name: printed, match: how, invoice_bank_last4: invLast4, master_bank_last4: v.bank_last4 },
    findings: out,
    vendor: v,
  };
}

// ------------------------------------------------------------------ PO MATCH
export function consumedOnPo(po: string, history: Pick<HistoryRun, "id" | "po_number" | "total" | "decision" | "review_decision" | "invoice_number">[], excludeRunId?: string) {
  const billed = history.filter((r) => r.po_number === po && r.id !== excludeRunId && effectiveDecision(r) === "APPROVE");
  return { amount: round2(billed.reduce((s, r) => s + (r.total ?? 0), 0)), invoices: billed.map((r) => r.invoice_number ?? "?") };
}

export function matchPo(
  ex: Extraction, vendor: Vendor | null, pos: PurchaseOrder[], history: HistoryRun[], runId: string, cfg: RuleConfig = DEFAULT_CONFIG,
): StageResult & { po: PurchaseOrder | null; method: "explicit" | "inferred" | "none" } {
  const S: StageKey = "po_match";
  const out: Finding[] = [];

  // 1. Explicit reference printed on the invoice
  if (ex.po_reference) {
    const ref = normId(ex.po_reference);
    const digits = ref.replace(/\D/g, "");
    const po = pos.find((p) => normId(p.po_number) === ref) ?? pos.find((p) => digits && normId(p.po_number).replace(/\D/g, "") === digits) ?? null;
    if (!po) {
      out.push(rule(cfg, S, "PO_NOT_FOUND", `Invoice references "${ex.po_reference}" but no such PO exists.`));
      return { status: statusFrom(out), summary: `PO "${ex.po_reference}" not found`, detail: { printed: ex.po_reference }, findings: out, po: null, method: "none" };
    }
    out.push(f(S, "pass", "PO_EXPLICIT", `Invoice references ${po.po_number}${ex.po_reference !== po.po_number ? ` (printed as "${ex.po_reference}")` : ""}.`));
    if (vendor && po.vendor_id !== vendor.id) out.push(rule(cfg, S, "PO_VENDOR_MISMATCH", `${po.po_number} belongs to a different vendor (${po.vendor_id}).`));
    if (po.status === "closed") out.push(rule(cfg, S, "PO_CLOSED", `${po.po_number} is closed.`));
    return { status: statusFrom(out), summary: `${po.po_number} · ${po.description}`, detail: { po_number: po.po_number, method: "explicit", printed: ex.po_reference }, findings: out, po, method: "explicit" };
  }

  // 2. No PO printed — infer from vendor's open POs using line items + remaining balance
  if (!vendor) {
    out.push(rule(cfg, S, "NO_PO", "No PO reference and vendor unknown — cannot infer a PO."));
    return { status: "skipped", summary: "Skipped — vendor unknown", detail: {}, findings: out, po: null, method: "none" };
  }
  const open = pos.filter((p) => p.vendor_id === vendor.id && p.status === "open");
  if (!open.length) {
    out.push(rule(cfg, S, "NO_PO", `No PO on invoice and ${vendor.name} has no open POs.`));
    return { status: statusFrom(out), summary: "No PO found", detail: {}, findings: out, po: null, method: "none" };
  }

  const total = ex.total ?? 0;
  const candidates = open
    .map((p) => {
      const remaining = p.amount - consumedOnPo(p.po_number, history, runId).amount;
      const desc = descriptionOverlap(ex.line_items.map((l) => l.description), [p.description, ...p.line_items.map((l) => l.description)]);
      const amountFit = remaining > 0 ? Math.max(0, 1 - Math.abs(remaining - total) / remaining) : 0;
      const fits = total <= remaining + p.amount * (cfg.tolerancePct / 100);
      return { p, remaining: round2(remaining), desc: round2(desc), amountFit: round2(amountFit), score: (fits ? 1 : 0.5) * (0.65 * desc + 0.35 * amountFit) };
    })
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const runnerUp = candidates[1]?.score ?? 0;
  const confidence = round2(Math.max(0, best.score - 0.5 * runnerUp * (runnerUp / Math.max(best.score, 0.01))));
  const detail = {
    method: "inferred",
    candidates: candidates.map((c) => ({ po_number: c.p.po_number, description: c.p.description, remaining: c.remaining, description_match: c.desc, amount_fit: c.amountFit, score: round2(c.score) })),
    confidence,
  };

  if (best.score < 0.35) {
    out.push(rule(cfg, S, "NO_PO", `No PO on invoice and none of ${vendor.name}'s ${open.length} open PO(s) fit the line items.`));
    return { status: statusFrom(out), summary: "Could not infer a PO", detail, findings: out, po: null, method: "none" };
  }

  const pct = Math.round(confidence * 100);
  const why = `${Math.round(best.desc * 100)}% of line-item terms match and amount fits remaining ${usd(best.remaining)}`;
  const autoAccept = cfg.inferredPoAutoAcceptPct != null && pct >= cfg.inferredPoAutoAcceptPct;
  if (autoAccept) {
    out.push(f(S, "pass", "PO_INFERRED_ACCEPTED", `No PO printed. Matched ${best.p.po_number} (${best.p.description}) with ${pct}% confidence — ${why}. Auto-accepted (policy: ≥ ${cfg.inferredPoAutoAcceptPct}%).`));
  } else {
    out.push(rule(cfg, S, "PO_INFERRED",
      `No PO printed. Best match is ${best.p.po_number} (${best.p.description}) with ${pct}% confidence — ${why}. Requester must confirm.`));
  }
  return { status: statusFrom(out), summary: `${autoAccept ? "Matched" : "Inferred"} ${best.p.po_number} (${pct}% confidence)`, detail: { ...detail, po_number: best.p.po_number }, findings: out, po: best.p, method: "inferred" };
}

// ------------------------------------------------------------------ AMOUNT & DUPLICATES
export function checkAmountsAndDuplicates(
  ex: Extraction, vendor: Vendor | null, po: PurchaseOrder | null, history: HistoryRun[], runId: string, fileHash: string, cfg: RuleConfig = DEFAULT_CONFIG,
): StageResult {
  const S: StageKey = "checks";
  const out: Finding[] = [];
  const detail: Record<string, unknown> = {};
  const total = ex.total ?? 0;
  const others = history.filter((r) => r.id !== runId);

  // --- Duplicates
  const sameFile = others.find((r) => r.file_hash && r.file_hash === fileHash);
  if (sameFile) {
    out.push(rule(cfg, S, "DUPLICATE_FILE", `This exact file was already processed in run #${sameFile.run_no}. Delete that run to process it again.`));
  }
  const norm = normId(ex.invoice_number);
  if (vendor && norm) {
    const prior = others.filter((r) => r.vendor_id === vendor.id && r.invoice_number_norm === norm);
    const live = prior.find((r) => effectiveDecision(r) !== "REJECT");
    if (live && !sameFile) {
      const printedDiff = live.invoice_number !== ex.invoice_number ? ` (printed now as "${ex.invoice_number}", originally "${live.invoice_number}")` : "";
      out.push(rule(cfg, S, "DUPLICATE_INVOICE",
        `Duplicate of ${live.invoice_number} from ${vendor.name}${printedDiff}, already ${effectiveDecision(live) === "APPROVE" ? "approved" : "on hold"} in run #${live.run_no} for ${usd(live.total)}.`));
      detail.duplicate_of = { run_id: live.id, run_no: live.run_no, invoice_number: live.invoice_number };
    } else if (prior.length) {
      out.push(f(S, "info", "PREVIOUSLY_REJECTED", `Invoice number was submitted before (run #${prior[0].run_no}) and rejected — treating as a corrected resubmission.`));
    }
    if (!live && ex.invoice_date && cfg.nearDuplicateDays > 0) {
      const near = others.find((r) => r.vendor_id === vendor.id && r.total != null && Math.abs(r.total - total) < 0.01 &&
        r.invoice_date && daysBetween(r.invoice_date, ex.invoice_date!) <= cfg.nearDuplicateDays && effectiveDecision(r) !== "REJECT");
      if (near) out.push(rule(cfg, S, "POSSIBLE_DUPLICATE", `Same vendor and same amount (${usd(total)}) as ${near.invoice_number} in run #${near.run_no}, within ${cfg.nearDuplicateDays} days — possible duplicate under a new number.`));
    }
  }
  if (!out.some((x) => x.code.includes("DUPLICATE"))) out.push(f(S, "pass", "NO_DUPLICATE", "No duplicate found (checked file fingerprint, normalised invoice number, amount + date)."));

  // --- Amount vs PO
  if (po) {
    const consumed = consumedOnPo(po.po_number, history, runId);
    const remaining = round2(po.amount - consumed.amount);
    const allowed = round2(po.amount * (cfg.tolerancePct / 100));
    const over = round2(total - remaining);
    detail.po = { po_number: po.po_number, po_amount: po.amount, already_billed: consumed.amount, billed_invoices: consumed.invoices, remaining, invoice_total: total, tolerance: allowed, tolerance_pct: cfg.tolerancePct };

    if (ex.currency && po.currency && ex.currency.toUpperCase() !== po.currency.toUpperCase()) {
      out.push(rule(cfg, S, "CURRENCY_MISMATCH", `Invoice currency ${ex.currency} differs from PO currency ${po.currency}.`));
    }
    const prev = consumed.invoices.length ? ` (${usd(consumed.amount)} already billed via ${consumed.invoices.join(", ")})` : "";
    if (over <= 0) {
      out.push(f(S, "pass", "AMOUNT_OK", `${usd(total)} is within remaining PO balance of ${usd(remaining)}${prev}.`));
    } else if (over <= allowed) {
      out.push(f(S, "pass", "WITHIN_TOLERANCE", `${usd(total)} exceeds remaining ${usd(remaining)} by ${usd(over)} (${((over / po.amount) * 100).toFixed(1)}% of PO) — within ${cfg.tolerancePct}% tolerance.`));
    } else {
      out.push(rule(cfg, S, "PO_OVERRUN",
        `${usd(total)} exceeds remaining balance on ${po.po_number} of ${usd(remaining)}${prev} by ${usd(over)} — ${remaining > 0 ? Math.round((over / remaining) * 100) + "% over remaining" : "PO fully consumed"}, beyond ${cfg.tolerancePct}% tolerance (${usd(allowed)}).`));
    }
  }

  // --- Approval limit (human sign-off for high-value invoices)
  if (cfg.approvalLimit != null && total > cfg.approvalLimit) {
    out.push(rule(cfg, S, "OVER_APPROVAL_LIMIT", `${usd(total)} is above the auto-approval limit of ${usd(cfg.approvalLimit)} — needs human sign-off.`));
  }

  const status = statusFrom(out);
  const dup = out.find((x) => x.code.startsWith("DUPLICATE") && blocking(x));
  const overrun = out.find((x) => x.code === "PO_OVERRUN");
  return {
    status,
    summary: dup ? "Duplicate detected" : overrun ? "Exceeds PO balance" : status === "warn" ? "Needs review" : "Amount within PO, no duplicates",
    detail,
    findings: out,
  };
}

// ------------------------------------------------------------------ DECIDE
const NEXT_ACTION: Record<string, string> = {
  NOT_AN_INVOICE: "Discard or forward to the right team; nothing to pay.",
  VENDOR_UNKNOWN: "Send the vendor an onboarding request; re-submit once they are in the vendor master.",
  VENDOR_BLOCKED: "Do not pay. Notify procurement that a blocked vendor is still invoicing.",
  DUPLICATE_INVOICE: "Do not pay. Reply to vendor that this invoice was already received/processed.",
  DUPLICATE_FILE: "Do not pay. This exact file was already processed.",
  BANK_MISMATCH: "Call the vendor on the number in the vendor master to verify bank details before any payment.",
  BANK_CHANGE_NOTICE: "Route bank change to vendor-master team for verified update; pay only to verified account.",
  PO_OVERRUN: "Ask procurement for a PO change order, or approve partial payment up to remaining balance.",
  PO_INFERRED: "Ask the requester to confirm the suggested PO, then approve.",
  PO_NOT_FOUND: "Ask the vendor for the correct PO number.",
  NO_PO: "Find the requester and raise or link a PO (no PO, no pay).",
  POSSIBLE_DUPLICATE: "Compare with the earlier invoice before approving.",
  TOTAL_MISMATCH: "Check the totals against the document; ask vendor for a corrected invoice if wrong.",
  LINES_MISMATCH: "Check the line items against the document; ask vendor for a corrected invoice if wrong.",
  LOW_CONFIDENCE: "Verify the flagged fields against the document.",
  MISSING_FIELD: "Ask the vendor to re-issue the invoice with the missing fields.",
  TAX_ID_MISMATCH: "Confirm the vendor's tax ID with procurement.",
  CURRENCY_MISMATCH: "Confirm the currency with the vendor and procurement.",
  PO_VENDOR_MISMATCH: "Confirm which PO this invoice belongs to.",
  PO_CLOSED: "Ask procurement whether the PO should be reopened.",
  FUTURE_DATE: "Confirm the invoice date with the vendor.",
  STALE_INVOICE: "Check whether this was already paid outside the system.",
  BAD_DATE: "Verify the invoice date against the document.",
  OVER_APPROVAL_LIMIT: "Route to an approver with authority for this amount.",
};

export function decide(all: Finding[], ctx: { vendorName?: string | null; invoiceNumber?: string | null; total?: number | null; po?: string | null; dueDate?: string | null }) {
  const rejects = all.filter((x) => x.severity === "reject");
  const holds = all.filter((x) => x.severity === "hold");
  const flags = all.filter((x) => x.severity === "info" && x.code !== "SCANNED");
  const decision: Decision = rejects.length ? "REJECT" : holds.length ? "HOLD" : "APPROVE";
  const id = `${ctx.vendorName ?? "Unknown vendor"} ${ctx.invoiceNumber ?? ""}`.trim();

  let summary: string;
  let nextActions: string[];
  if (decision === "APPROVE") {
    const tol = all.find((x) => x.code === "WITHIN_TOLERANCE");
    const notes = [tol && "small overage within tolerance", flags.length && `${flags.length} flag${flags.length > 1 ? "s" : ""} noted`].filter(Boolean);
    summary = `Approved — ${id} for ${usd(ctx.total)}${ctx.po ? ` matched to ${ctx.po}` : ""}; no blocking issues${notes.length ? ` (${notes.join(", ")})` : ""}.`;
    nextActions = [`Schedule for payment${ctx.dueDate ? ` by due date ${ctx.dueDate}` : ""}.`];
  } else {
    const b = decision === "REJECT" ? rejects : holds;
    summary = `${decision === "REJECT" ? "Rejected" : "On hold"} — ${id}: ${b[0].message}${b.length > 1 ? ` (+${b.length - 1} more)` : ""}`;
    nextActions = [...new Set(b.map((x) => NEXT_ACTION[x.code]).filter(Boolean))];
  }

  return {
    decision,
    summary,
    next_action: nextActions.join(" "),
    status: (decision === "APPROVE" ? "done" : decision === "HOLD" ? "warn" : "failed") as StepStatus,
    counts: { reject: rejects.length, hold: holds.length, flag: flags.length, pass: all.filter((x) => x.severity === "pass").length },
  };
}
