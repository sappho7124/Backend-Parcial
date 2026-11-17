import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password || !body?.full_name) {
    return NextResponse.json({ error: "email, password y full_name son obligatorios" }, { status: 400 });
  }

  const allowedRoles = ["MINORISTA", "MAYORISTA", "ADMIN"];
  const role = allowedRoles.includes(body.role) ? body.role : "MINORISTA";
  const passwordHash = crypto.createHash("sha256").update(body.password).digest("hex");

  const { data: user, error: userErr } = await supabase
    .from("users")
    .insert({ email: body.email.toLowerCase().trim(), password_hash: passwordHash, role })
    .select("id, email, role, points, created_at")
    .single();

  if (userErr) {
    return NextResponse.json({ error: userErr.message }, { status: 400 });
  }

  await supabase.from("profiles").insert({
    user_id: user.id,
    full_name: body.full_name,
    phone_number: body.phone_number ?? null,
    address: body.address ?? null,
    document_type: body.document_type ?? "CC",
    document_number: body.document_number ?? null,
  });

  return NextResponse.json({ user }, { status: 201 });
}