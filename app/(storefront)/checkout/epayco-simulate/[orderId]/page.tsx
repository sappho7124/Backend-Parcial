import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";
import { EpaycoCheckoutForm } from "@/src/features/payments/ui/EpaycoCheckoutForm";

interface PageProps {
  params: Promise<{ orderId: string }>;
}

type SimulatedOrder = {
  id: string;
  total_amount: number | string;
  metadata: Record<string, unknown> | null;
  users: { email: string | null } | Array<{ email: string | null }> | null;
};

export default async function EpaycoSimulatePage({ params }: PageProps) {
  const { orderId } = await params;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Error de configuración</h1>
          <p className="text-gray-600">No se pudo conectar con la base de datos.</p>
        </div>
      </div>
    );
  }

  const { data, error } = await supabase
    .from("orders")
    .select("id, total_amount, metadata, users(email)")
    .eq("id", orderId)
    .single();

  const order = data as SimulatedOrder | null;

  if (error || !order) {
    // eslint-disable-next-line no-console
    if (error) console.error("[EpaycoSimulatePage] Error cargando orden:", error);
    notFound();
  }

  // Lógica de metadatos
  const currentMetadata =
    order?.metadata && typeof order.metadata === "object"
      ? (order.metadata as Record<string, unknown>)
      : {};

  const nextMetadata = {
    ...currentMetadata,
    payment_provider: "epayco",
  };

  await supabase
    .from("orders")
    .update({ metadata: nextMetadata })
    .eq("id", orderId);

  // ePayco credentials from env
  const publicKey = process.env.EPAYCO_PUBLIC_KEY ?? "";
  const isTest = process.env.EPAYCO_TEST === "true";
  const headerStore = await headers();
  const forwardedProto = headerStore.get("x-forwarded-proto") ?? "http";
  const forwardedHost = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const requestSiteUrl = forwardedHost ? `${forwardedProto}://${forwardedHost}` : null;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? requestSiteUrl ?? "http://localhost:3000";

  if (!publicKey) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Error de configuración</h1>
          <p className="text-gray-600">Falta la clave pública de ePayco (EPAYCO_PUBLIC_KEY).</p>
        </div>
      </div>
    );
  }

  const relatedUserEmail = Array.isArray(order.users)
    ? order.users[0]?.email
    : order.users?.email;

  const amountCOP = Number(order.total_amount ?? 0);
  const invoiceRef = `ORD-${order.id.slice(0, 8).toUpperCase()}`;
  const userEmail = relatedUserEmail ?? "";

  const checkoutData = {
    name: `Pedido SwiftDrop ${invoiceRef}`,
    description: `Compra en SwiftDrop — ${invoiceRef}`,
    invoice: invoiceRef,
    currency: "cop",
    amount: amountCOP.toFixed(2),
    tax_base: amountCOP.toFixed(2),
    tax: "0.00",
    country: "co",
    lang: "es",
    external: "false",
    confirmation: `${siteUrl}/api/v1/payments/epayco-webhook`,
    response: `${siteUrl}/order/success/${orderId}`,
    email: userEmail,
    extra1: orderId,
    extra2: invoiceRef,
  };

  return <EpaycoCheckoutForm publicKey={publicKey} checkoutData={checkoutData} isTest={isTest} />;
}