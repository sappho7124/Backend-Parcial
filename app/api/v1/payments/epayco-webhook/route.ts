import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";
import { EpaycoService } from "@/src/services/EpaycoService";

export async function POST(req: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  try {
    const contentType = req.headers.get("content-type") ?? "";
    let payload: Record<string, string> = {};

    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else {
      const text = await req.text();
      new URLSearchParams(text).forEach((v, k) => {
        payload[k] = v;
      });
    }

    const result = await EpaycoService.processWebhook(supabase, payload);
    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error procesando webhook";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}