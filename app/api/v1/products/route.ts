import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

export async function GET(req: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const role = searchParams.get("role") ?? "MINORISTA";

  let query = supabase.from("products").select("*");
  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Descuento mayorista del 15% según Cuadro 1 de Backend_Documento.pdf
  const products = (data ?? []).map((p) => ({
    ...p,
    effective_price: role === "MAYORISTA" ? Number((Number(p.price) * 0.85).toFixed(2)) : Number(p.price),
  }));

  return NextResponse.json({ products }, { status: 200 });
}

export async function POST(req: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body?.name || body?.price == null || body?.weight_kg == null) {
    return NextResponse.json({ error: "name, price y weight_kg son requeridos" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      name: body.name,
      description: body.description ?? null,
      price: Number(body.price),
      weight_kg: Number(body.weight_kg),
      stock: Number(body.stock ?? 0),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ product: data }, { status: 201 });
}