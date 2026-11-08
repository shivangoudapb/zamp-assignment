export type Decision = "APPROVE" | "HOLD" | "REJECT";
export type Severity = "pass" | "info" | "hold" | "reject";
export type StageKey = "ingest" | "extract" | "validate" | "vendor" | "po_match" | "checks" | "decide";
export type StepStatus = "pending" | "running" | "done" | "warn" | "failed" | "skipped";

export const STAGES: { key: StageKey; label: string; blurb: string }[] = [
  { key: "ingest", label: "Ingest", blurb: "Store the file and fingerprint it" },
  { key: "extract", label: "Extract", blurb: "AI reads the invoice into structured fields" },
  { key: "validate", label: "Validate", blurb: "Required fields, arithmetic, dates, confidence" },
  { key: "vendor", label: "Vendor check", blurb: "Match to vendor master, status, bank details" },
  { key: "po_match", label: "PO match", blurb: "Find the purchase order (explicit or inferred)" },
  { key: "checks", label: "Amount & duplicates", blurb: "PO balance, tolerance, duplicate detection" },
  { key: "decide", label: "Decision", blurb: "Combine findings into a reasoned outcome" },
];

export type Finding = { code: string; severity: Severity; stage: StageKey; message: string };

export type LineItem = { description: string; quantity: number | null; unit_price: number | null; amount: number | null };

// What Gemini returns. Every field can be null — invoices are messy.
export type Extraction = {
  is_invoice: boolean;
  document_type: string;
  vendor_name: string | null;
  vendor_tax_id: string | null;
  vendor_email: string | null;
  vendor_bank_account: string | null;
  bank_details_changed_notice: boolean;
  invoice_number: string | null;
  invoice_date: string | null; // YYYY-MM-DD
  due_date: string | null;
  po_reference: string | null;
  currency: string | null;
  line_items: LineItem[];
  subtotal: number | null;
  tax_amount: number | null;
  other_charges: number | null;
  total: number | null;
  tax_inclusive: boolean;
  is_scanned_image: boolean;
  confidence: {
    vendor_name: number;
    invoice_number: number;
    invoice_date: number;
    total: number;
    po_reference: number;
  };
  notes: string | null;
};

export type Vendor = {
  id: string; name: string; aliases: string[]; tax_id: string | null; email: string | null;
  bank_last4: string | null; status: "approved" | "blocked";
};

export type PurchaseOrder = {
  po_number: string; vendor_id: string; description: string; amount: number; currency: string;
  line_items: { description: string; quantity: number; unit_price: number }[]; status: "open" | "closed";
};
