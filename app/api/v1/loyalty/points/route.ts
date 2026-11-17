import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

export async function GET(req: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("user_id");
  if (!userId) return NextResponse.json({ error: "user_id requerido" }, { status: 400 });

  const [{ data: user }, { data: history }] = await Promise.all([
    supabase.from("users").select("points").eq("id", userId).maybeSingle(),
    supabase.from("loyalty_points").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
  ]);

  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  return NextResponse.json({ points: user.points, history: history ?? [] }, { status: 200 });
}