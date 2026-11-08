import { NextResponse } from "next/server";
import { BUCKET, db } from "@/lib/supabase";
import { PURCHASE_ORDERS, VENDORS, seedRunRows } from "@/lib/seed";

export const runtime = "nodejs";

// POST /api/reset - wipe all runs and reload the demo reference data.
export async function POST() {
  const s = db();

  // Remove uploaded files (best effort)
  const { data: folders } = await s.storage.from(BUCKET).list("", { limit: 1000 });
  for (const folder of folders ?? []) {
    const { data: files } = await s.storage.from(BUCKET).list(folder.name, { limit: 100 });
    if (files?.length) await s.storage.from(BUCKET).remove(files.map((f) => `${folder.name}/${f.name}`));
  }

  type Result = { error: { message: string } | null };
  const steps: (() => PromiseLike<Result>)[] = [
    () => s.from("runs").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    () => s.from("purchase_orders").delete().neq("po_number", ""),
    () => s.from("vendors").delete().neq("id", ""),
    () => s.from("vendors").insert(VENDORS),
    () => s.from("purchase_orders").insert(PURCHASE_ORDERS),
    () => s.from("runs").insert(seedRunRows()),
  ];
  for (const step of steps) {
    const { error } = await step();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, vendors: VENDORS.length, purchase_orders: PURCHASE_ORDERS.length });
}
