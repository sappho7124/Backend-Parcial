import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

export async function GET() {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  const { data: drones, error } = await supabase.from("drone_fleet").select("*").order("model");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ drones: drones ?? [] }, { status: 200 });
}