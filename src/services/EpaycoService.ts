import type { SupabaseClient } from "@supabase/supabase-js";
import { InvoiceService } from "./InvoiceService";

export class EpaycoService {
  static async processWebhook(supabase: SupabaseClient, payload: Record<string, string>) {
    const orderId = payload.x_extra1 ?? payload.extra1 ?? "";
    const refPayco = payload.x_ref_payco ?? payload.ref_payco ?? `EPAYCO-${Date.now()}`;
    const codResponse = payload.x_cod_response ?? payload.cod_response ?? "";
    const responseText = (payload.x_response ?? payload.response ?? "").toLowerCase();
    const amount = Number(payload.x_amount ?? payload.amount ?? 0);
    const currency = payload.x_currency_code ?? payload.currency_code ?? "COP";

    if (!orderId) {
      throw new Error("order_id (x_extra1) requerido en webhook");
    }

    const isApproved = codResponse === "1" || responseText === "aceptada";
    const paymentStatus = isApproved ? "APPROVED" : codResponse === "3" ? "PENDING" : "REJECTED";
    const orderStatus = isApproved ? "IN_TRANSIT" : codResponse === "3" ? "PENDING" : "CANCELLED";

    await supabase.from("payments").upsert(
      {
        order_id: orderId,
        provider: "EPAYCO",
        provider_ref: refPayco,
        amount,
        currency,
        status: paymentStatus,
        webhook_payload: payload,
      },
      { onConflict: "provider_ref" },
    );

    await supabase.from("orders").update({ status: orderStatus }).eq("id", orderId);

    let invoiceUrl: string | null = null;
    if (isApproved) {
      invoiceUrl = await InvoiceService.generateAndUploadInvoice(supabase, orderId);
    }

    return { orderId, paymentStatus, orderStatus, invoiceUrl };
  }
}