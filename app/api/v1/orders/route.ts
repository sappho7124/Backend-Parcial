import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";
import { LogisticsService } from "@/src/services/LogisticsService";
import { TwilioService } from "@/src/services/TwilioService";

export async function POST(req: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  const body = await req.json().catch(() => null);
  const userId: string = body?.user_id;
  const items: Array<{ product_id: string; quantity: number }> = body?.items ?? [];

  if (!userId || items.length === 0) {
    return NextResponse.json({ error: "user_id e items son obligatorios" }, { status: 400 });
  }

  const { data: user } = await supabase.from("users").select("id, role, points").eq("id", userId).maybeSingle();
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const { data: profile } = await supabase.from("profiles").select("phone_number").eq("user_id", userId).maybeSingle();

  const productIds = items.map((i) => i.product_id);
  const { data: dbProducts } = await supabase.from("products").select("*").in("id", productIds);
  if (!dbProducts || dbProducts.length === 0) {
    return NextResponse.json({ error: "Productos inválidos" }, { status: 400 });
  }

  let totalAmount = 0;
  let totalWeight = 0;
  const discountFactor = user.role === "MAYORISTA" ? 0.85 : 1;

  const preparedItems = items.map((item) => {
    const prod = dbProducts.find((p) => p.id === item.product_id);
    if (!prod || prod.stock < item.quantity) {
      throw new Error(`Stock insuficiente para ${prod?.name ?? item.product_id}`);
    }
    const unitPrice = Number((Number(prod.price) * discountFactor).toFixed(2));
    const subtotal = Number((unitPrice * item.quantity).toFixed(2));
    totalAmount += subtotal;
    totalWeight += Number(prod.weight_kg) * item.quantity;

    return {
      product_id: prod.id,
      quantity: item.quantity,
      unit_price: unitPrice,
      subtotal,
      new_stock: prod.stock - item.quantity,
    };
  });

  // 1. Asignación logística multimodal
  const logistics = await LogisticsService.assignDelivery(supabase, totalWeight);

  // 2. Crear orden
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      drone_id: logistics.drone_id,
      total_amount: totalAmount,
      status: "IN_TRANSIT",
      delivery_vehicle: logistics.delivery_vehicle,
      delivery_pin: logistics.delivery_pin,
    })
    .select("*")
    .single();

  if (orderErr || !order) {
    return NextResponse.json({ error: orderErr?.message ?? "Error creando pedido" }, { status: 500 });
  }

  // 3. Insertar items y actualizar stock
  await supabase.from("order_items").insert(
    preparedItems.map(({ new_stock: _, ...rest }) => ({ order_id: order.id, ...rest })),
  );

  for (const item of preparedItems) {
    await supabase.from("products").update({ stock: item.new_stock }).eq("id", item.product_id);
  }

  // 4. Generar ruta GPS simulada y enviar SMS PIN
  await LogisticsService.seedInitialRoute(supabase, order.id, logistics.delivery_vehicle);
  await TwilioService.sendDeliveryPin(profile?.phone_number, order.id, logistics.delivery_pin);

  // 5. Acumular puntos de fidelización (1 punto por cada $1.000 COP)
  const earnedPoints = Math.floor(totalAmount / 1000);
  if (earnedPoints > 0) {
    await supabase.from("loyalty_points").insert({
      user_id: userId,
      order_id: order.id,
      points_delta: earnedPoints,
      type: "EARNED",
      description: `Compra pedido #${order.id.slice(0, 8)}`,
    });
    await supabase.from("users").update({ points: (user.points ?? 0) + earnedPoints }).eq("id", userId);
  }

  return NextResponse.json({ order, earnedPoints }, { status: 201 });
}