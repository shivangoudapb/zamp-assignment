// Fuzzy matching helpers — pure functions, no I/O.

const LEGAL_SUFFIXES = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|pvt|plc|gmbh|group|the)\b/g;

export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(LEGAL_SUFFIXES, " ").replace(/\s+/g, " ").trim();
}

/** INV-0457, inv 0457, INV0457 → "INV0457" */
export function normId(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, " ");
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice similarity on character bigrams, 0..1 */
export function similarity(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  if (!A.length || !B.length) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) { hits++; counts.set(g, c - 1); }
  }
  return (2 * hits) / (A.length + B.length);
}

const STOP = new Set(["the", "and", "of", "for", "a", "an", "with", "per", "box", "x", "pcs", "each"]);
export function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Share of invoice-description tokens that also appear in the PO descriptions, 0..1 */
export function descriptionOverlap(invoiceDescs: string[], poDescs: string[]): number {
  const inv = tokens(invoiceDescs.join(" "));
  const po = tokens(poDescs.join(" "));
  if (!inv.size) return 0;
  let hit = 0;
  for (const t of inv) if (po.has(t)) hit++;
  return hit / inv.size;
}

export function last4(s: string | null | undefined): string | null {
  const digits = (s ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
