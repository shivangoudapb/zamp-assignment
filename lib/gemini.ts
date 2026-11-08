import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { Extraction } from "./types";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const num = { type: ["number", "null"] };
const str = { type: ["string", "null"] };

// JSON schema the model must fill. Gemini is used ONLY to read the document —
// every decision is made later by deterministic rules (lib/rules.ts).
const SCHEMA = {
  type: "object",
  properties: {
    is_invoice: { type: "boolean", description: "True only if this document is a vendor invoice / bill requesting payment." },
    document_type: { type: "string", description: "e.g. invoice, credit note, quote, receipt, statement, other" },
    vendor_name: { ...str, description: "Legal name of the vendor issuing the invoice, exactly as printed." },
    vendor_tax_id: str,
    vendor_email: str,
    vendor_bank_account: { ...str, description: "Bank account number or masked number exactly as printed (e.g. '****4821', 'ending 7730')." },
    bank_details_changed_notice: { type: "boolean", description: "True if the document says the vendor's bank / remittance details have changed." },
    invoice_number: { ...str, description: "Exactly as printed, keep dashes and prefixes." },
    invoice_date: { ...str, description: "ISO format YYYY-MM-DD. Interpret US-style 11/05/2026 as November 5." },
    due_date: str,
    po_reference: { ...str, description: "Purchase order number exactly as printed, or null if none is printed. Do not guess." },
    currency: { ...str, description: "ISO currency code, e.g. USD" },
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: { description: { type: "string" }, quantity: num, unit_price: num, amount: num },
        required: ["description", "quantity", "unit_price", "amount"],
      },
    },
    subtotal: num,
    tax_amount: { ...num, description: "Tax amount; 0 if exempt or none; null if not stated." },
    other_charges: { ...num, description: "Freight, shipping, handling or other charges listed outside line items." },
    total: { ...num, description: "Final amount payable." },
    tax_inclusive: { type: "boolean", description: "True if line prices already include tax (no separate tax added)." },
    is_scanned_image: { type: "boolean", description: "True if the document appears to be a scan or photo rather than a digital PDF." },
    confidence: {
      type: "object",
      description: "Your confidence 0-1 that each field was read correctly. Lower it for blurry, ambiguous or missing values.",
      properties: {
        vendor_name: { type: "number" }, invoice_number: { type: "number" }, invoice_date: { type: "number" },
        total: { type: "number" }, po_reference: { type: "number" },
      },
      required: ["vendor_name", "invoice_number", "invoice_date", "total", "po_reference"],
    },
    notes: { ...str, description: "Anything unusual a reviewer should know (handwriting, stamps, warnings, illegible parts)." },
  },
  required: [
    "is_invoice", "document_type", "vendor_name", "vendor_tax_id", "vendor_email", "vendor_bank_account",
    "bank_details_changed_notice", "invoice_number", "invoice_date", "due_date", "po_reference", "currency",
    "line_items", "subtotal", "tax_amount", "other_charges", "total", "tax_inclusive", "is_scanned_image",
    "confidence", "notes",
  ],
};

const PROMPT = `You are an accounts-payable data extraction engine.
Read the attached document and return the fields in the JSON schema.
Rules:
- Copy values exactly as printed. Never invent a value: use null when a field is not present.
- The invoice is addressed TO the buyer (Brightline Manufacturing); vendor_name is the company that ISSUED it.
- po_reference: only a purchase order number actually printed on the document (it may appear as "PO", "Order ref", "Customer PO"). If none is printed, return null.
- Amounts are plain numbers without currency symbols or thousands separators.
- Be honest in the confidence scores.`;

export async function extractInvoice(file: Buffer, mimeType: string): Promise<{ data: Extraction; model: string; ms: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY in .env.local");
  // Structured JSON output is only served on the v1beta API.
  const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });
  const t0 = Date.now();

  for (let attempt = 1; ; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: file.toString("base64") } }, { text: PROMPT }] }],
        // Extraction is reading, not reasoning — disabling "thinking" cuts latency ~3x with no accuracy loss on our samples.
        config: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      });
      const text = res.text;
      if (!text) throw new Error("Empty response from Gemini");
      return { data: JSON.parse(text) as Extraction, model: MODEL, ms: Date.now() - t0 };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const rateLimited = /\b429\b|RESOURCE_EXHAUSTED/.test(msg);
      const transient = rateLimited || /\b(500|502|503|504)\b|UNAVAILABLE|fetch failed|ECONNRESET|Empty response|JSON/.test(msg);
      // Retry only errors that a retry can fix; a 400 (bad request) will fail the same way again.
      if (!transient || attempt >= 3) {
        if (rateLimited) throw new Error("Gemini rate limit reached (free tier allows ~5 invoices per minute). Wait a minute and re-run.");
        throw new Error(`Gemini extraction failed: ${msg.slice(0, 300)}`);
      }
      const hinted = Number(msg.match(/retry in ([\d.]+)s/i)?.[1] ?? 0);
      const wait = rateLimited ? Math.min(Math.max(hinted, 5), 25) : 1500 * attempt / 1000;
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}
