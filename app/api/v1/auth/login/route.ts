import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "Credenciales incompletas" }, { status: 400 });
  }

  const passwordHash = crypto.createHash("sha256").update(body.password).digest("hex");
  const { data: user } = await supabase
    .from("users")
    .select("id, email, role, points, profiles(full_name, phone_number, address)")
    .eq("email", body.email.toLowerCase().trim())
    .eq("password_hash", passwordHash)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  const token = Buffer.from(JSON.stringify({ sub: user.id, role: user.role, exp: Date.now() + 86400000 })).toString("base64");
  return NextResponse.json({ token, user }, { status: 200 });
}