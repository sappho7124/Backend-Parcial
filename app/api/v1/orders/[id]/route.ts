import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  const { data: order, error } = await supabase
    .from("orders")
    .select("*, order_items(*, products(name, weight_kg)), drone_fleet(*), invoices(*), payments(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });

  return NextResponse.json({ order }, { status: 200 });
}