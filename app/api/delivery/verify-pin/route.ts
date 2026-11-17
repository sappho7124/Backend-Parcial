import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ success: false, error: "Server misconfigured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const orderId = (body.orderId || "").trim();
  const pinInput = (body.pin || "").trim();

  if (!orderId || !pinInput) {
    return NextResponse.json({ success: false, error: "Orden y PIN son requeridos." }, { status: 400 });
  }

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, delivery_pin, drone_id")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return NextResponse.json({ success: false, error: "Pedido no encontrado." }, { status: 404 });
  if (order.status === "DELIVERED") {
    return NextResponse.json({ success: false, error: "Este pedido ya fue entregado." }, { status: 400 });
  }
  if ((order.delivery_pin || "").trim() !== pinInput) {
    return NextResponse.json({ success: false, error: "PIN incorrecto." }, { status: 403 });
  }

  await supabase.from("orders").update({ status: "DELIVERED" }).eq("id", orderId);

  if (order.drone_id) {
    await supabase.from("drone_fleet").update({ status: "AVAILABLE" }).eq("id", order.drone_id);
  }

  return NextResponse.json({ success: true, message: "Entrega confirmada correctamente." });
}