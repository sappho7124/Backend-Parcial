import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { SupabaseClient } from "@supabase/supabase-js";

export class InvoiceService {
  static async generateAndUploadInvoice(supabase: SupabaseClient, orderId: string): Promise<string> {
    // Verificar si ya existe factura
    const { data: existing } = await supabase
      .from("invoices")
      .select("pdf_url")
      .eq("order_id", orderId)
      .maybeSingle();

    if (existing?.pdf_url) return existing.pdf_url;

    const { data: order } = await supabase
      .from("orders")
      .select("id, total_amount, status, delivery_vehicle, created_at, users(email, role), order_items(quantity, unit_price, subtotal, products(name))")
      .eq("id", orderId)
      .single();

    if (!order) throw new Error("Orden no encontrada para facturación");

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, document_type, document_number, address")
      .eq("user_id", (order as Record<string, unknown>).user_id as string)
      .maybeSingle();

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFillColor(15, 15, 15);
    doc.rect(0, 0, 595, 80, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text("SWIFTDROP — FACTURA ELECTRÓNICA", 40, 50);

    doc.setTextColor(20, 20, 20);
    doc.setFontSize(11);
    doc.text(`Orden ID: ${order.id}`, 40, 110);
    doc.text(`Cliente: ${profile?.full_name ?? "Cliente SwiftDrop"}`, 40, 128);
    doc.text(`Documento: ${profile?.document_type ?? "CC"} ${profile?.document_number ?? "N/A"}`, 40, 146);
    doc.text(`Dirección: ${profile?.address ?? "Bucaramanga, Colombia"}`, 40, 164);
    doc.text(`Fecha: ${new Date(order.created_at).toLocaleDateString("es-CO")}`, 40, 182);

    const items = (order.order_items as Array<{
      quantity: number;
      unit_price: number;
      subtotal: number;
      products?: { name?: string } | null;
    }>) ?? [];

    autoTable(doc, {
      startY: 205,
      head: [["Repuesto", "Cant.", "Precio Unit.", "Subtotal"]],
      body: items.map((it) => [
        it.products?.name ?? "Repuesto automotriz",
        String(it.quantity),
        `$${Number(it.unit_price).toLocaleString("es-CO")}`,
        `$${Number(it.subtotal).toLocaleString("es-CO")}`,
      ]),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalY = (doc as any).lastAutoTable?.finalY ?? 300;
    doc.setFontSize(13);
    doc.text(`TOTAL PAGADO: $${Number(order.total_amount).toLocaleString("es-CO")} COP`, 40, finalY + 35);

    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const filePath = `invoice-${orderId}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from("invoices")
      .upload(filePath, pdfBuffer, { contentType: "application/pdf", upsert: true });

    if (uploadErr) throw new Error(`Error subiendo PDF a Storage: ${uploadErr.message}`);

    const { data: publicData } = supabase.storage.from("invoices").getPublicUrl(filePath);
    const pdfUrl = publicData.publicUrl;

    await supabase.from("invoices").insert({
      order_id: orderId,
      pdf_url: pdfUrl,
    });

    return pdfUrl;
  }
}