import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, delivery_vehicle, drone_id, drone_fleet(model, status)")
    .eq("id", id)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });

  const { data: coordinates } = await supabase
    .from("gps_tracking")
    .select("*")
    .eq("order_id", id)
    .order("recorded_at", { ascending: true });

  const progress = order.status === "DELIVERED" ? 100 : order.status === "IN_TRANSIT" ? 65 : 15;

  return NextResponse.json({ order, coordinates: coordinates ?? [], progress }, { status: 200 });
}