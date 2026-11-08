import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { consumedOnPo, type HistoryRun } from "@/lib/rules";

export const runtime = "nodejs";

// GET /api/reference — vendors and POs with live remaining balances.
export async function GET() {
  const [{ data: vendors }, { data: pos }, { data: runs }] = await Promise.all([
    db().from("vendors").select("*").order("id"),
    db().from("purchase_orders").select("*").order("po_number"),
    db().from("runs").select("id,po_number,total,decision,review_decision,invoice_number").eq("status", "done"),
  ]);
  const history = ((runs ?? []) as HistoryRun[]).map((r) => ({ ...r, total: r.total == null ? null : Number(r.total) }));
  const purchase_orders = (pos ?? []).map((p) => {
    const c = consumedOnPo(p.po_number, history);
    return { ...p, amount: Number(p.amount), billed: c.amount, billed_invoices: c.invoices, remaining: Number(p.amount) - c.amount };
  });
  return NextResponse.json({ vendors: vendors ?? [], purchase_orders });
}
