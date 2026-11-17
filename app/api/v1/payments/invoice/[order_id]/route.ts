import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";
import { InvoiceService } from "@/src/services/InvoiceService";

export async function GET(_req: Request, { params }: { params: Promise<{ order_id: string }> }) {
  const { order_id } = await params;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  try {
    const pdfUrl = await InvoiceService.generateAndUploadInvoice(supabase, order_id);
    return NextResponse.json({ order_id, pdf_url: pdfUrl }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo obtener la factura";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}