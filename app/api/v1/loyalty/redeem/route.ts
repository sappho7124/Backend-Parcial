import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  const body = await req.json().catch(() => null);
  const userId = body?.user_id;
  const pointsToRedeem = Number(body?.points ?? 0);

  if (!userId || pointsToRedeem <= 0) {
    return NextResponse.json({ error: "user_id y points (>0) requeridos" }, { status: 400 });
  }

  const { data: user } = await supabase.from("users").select("points").eq("id", userId).maybeSingle();
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  if (user.points < pointsToRedeem) {
    return NextResponse.json({ error: "Saldo de puntos insuficiente" }, { status: 400 });
  }

  const newBalance = user.points - pointsToRedeem;
  await supabase.from("users").update({ points: newBalance }).eq("id", userId);
  await supabase.from("loyalty_points").insert({
    user_id: userId,
    order_id: body?.order_id ?? null,
    points_delta: -pointsToRedeem,
    type: "REDEEMED",
    description: "Canje de puntos en SwiftDrop",
  });

  return NextResponse.json({ points: newBalance, discount_cop: pointsToRedeem * 100 }, { status: 200 });
}