"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  Package,
  Truck,
} from "lucide-react";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { getSupabaseBrowserClient } from "@/src/lib/supabase/browser";

type TrackingAssignment = {
  assigned_vehicle_type?: string;
  estimated_weight_kg?: number;
  estimated_distance_km?: number;
  drones?: { name?: string } | null;
  delivery_vehicles?: { name?: string } | null;
};

type Order = {
  id: string;
  user_id: string;
  created_at: string;
  status: string;
  total_amount: number | string;
  delivery_vehicle: "DRONE" | "MOTORCYCLE" | "BICYCLE" | string | null;
  delivery_pin: string | null;
  metadata?: Record<string, unknown> | null;
  drone_fleet?: { model?: string } | Array<{ model?: string }> | null;
};

type OrderItemRow = {
  id: string;
  quantity: number;
  unit_price: number | string;
  subtotal: number | string;
  products?: { name?: string } | Array<{ name?: string }> | null;
};

type NormalizedOrderItem = {
  id: string;
  title: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

type ShippingInfo = {
  name: string | null;
  phone: string | null;
  address: string | null;
};

function formatCOP(amount: number | string) {
  const numeric = Number(amount) || 0;
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `$${numeric.toLocaleString("es-CO")} COP`;
  }
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function OrderTrackingSection({
  orderId,
  fallbackVehicle,
  fallbackDroneModel,
  fallbackWeightKg,
}: {
  orderId: string;
  fallbackVehicle?: string | null;
  fallbackDroneModel?: string | null;
  fallbackWeightKg?: number;
}) {
  const [assignment, setAssignment] = useState<TrackingAssignment | null>(null);
  const [coords, setCoords] = useState<unknown[]>([]);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/tracking/${orderId}`);
        if (res.ok) {
          const data = await res.json();
          setAssignment((data.assignment as TrackingAssignment | null) ?? null);
          setCoords(data.coordinates ?? []);
          setProgress(data.progress ?? 0);
        }
      } catch {
        // Fallback a los datos guardados directamente en la orden
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [orderId]);

  if (loading) {
    return (
      <div className="border border-gray-100 bg-white p-8">
        <p className="text-sm text-gray-500">Cargando seguimiento…</p>
      </div>
    );
  }

  const VEHICLE_LABELS: Record<string, string> = {
    drone: "🚁 Drone",
    motorcycle: "🏍️ Moto",
    bicycle: "🚲 Bicicleta",
  };

  const resolvedVehicleKey = (
    assignment?.assigned_vehicle_type ||
    fallbackVehicle ||
    ""
  ).toLowerCase();

  const resolvedVehicleName =
    assignment?.drones?.name ??
    assignment?.delivery_vehicles?.name ??
    fallbackDroneModel ??
    (resolvedVehicleKey === "drone"
      ? "Dron de reparto SwiftDrop"
      : resolvedVehicleKey === "motorcycle"
      ? "Motocicleta de reparto"
      : resolvedVehicleKey === "bicycle"
      ? "Bicicleta de reparto"
      : "Vehículo asignado");

  const resolvedWeight =
    assignment?.estimated_weight_kg ?? fallbackWeightKg ?? 0;

  const hasDeliveryInfo = Boolean(assignment || fallbackVehicle);

  return (
    <div className="border border-gray-100 bg-white overflow-hidden">
      <div className="p-8 border-b border-gray-100">
        <div className="flex items-center gap-3 mb-3">
          <Truck size={20} strokeWidth={1.5} />
          <h2 className="text-xl font-normal">Seguimiento</h2>
        </div>
        <p className="text-sm text-gray-500">Estado actual de tu envío.</p>
      </div>

      {hasDeliveryInfo ? (
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">
              {VEHICLE_LABELS[resolvedVehicleKey] ?? "🚚"}
            </span>
            <div>
              <p className="text-sm font-medium">{resolvedVehicleName}</p>
              <p className="text-xs text-gray-400 uppercase">
                {resolvedVehicleKey || "Logística estándar"}
              </p>
            </div>
          </div>

          <div className="text-xs text-gray-500 mb-4">
            Peso estimado: {resolvedWeight} kg
            {typeof assignment?.estimated_distance_km === "number"
              ? ` — Distancia: ${assignment.estimated_distance_km.toFixed(1)} km`
              : ""}
          </div>

          {coords.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-2">
                Progreso: {Math.round(progress)}%
              </p>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-black transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <p className="text-xs text-gray-400">
            Mapa interactivo disponible en /track-order
          </p>
        </div>
      ) : (
        <div className="p-8 text-center">
          <Package size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">
            Tu pedido aún no tiene asignación de entrega.
          </p>
        </div>
      )}
    </div>
  );
}

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default function OrderDetailsPage({ params }: Props) {
  const resolvedParams = use(params);

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<NormalizedOrderItem[]>([]);
  const [shippingInfo, setShippingInfo] = useState<ShippingInfo | null>(null);

  useEffect(() => {
    async function run() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      setLoading(true);

      const { data: orderData, error: orderError } = await supabase
        .from("orders")
        .select(
          `
          id,
          user_id,
          created_at,
          status,
          total_amount,
          delivery_vehicle,
          delivery_pin,
          metadata,
          drone_fleet(model)
        `,
        )
        .eq("id", resolvedParams.id)
        .maybeSingle();

      if (orderError || !orderData) {
        // eslint-disable-next-line no-console
        if (orderError) console.error("[OrderDetailsPage] Error:", orderError);
        setLoading(false);
        return;
      }

      const typedOrder = orderData as unknown as Order;
      setOrder(typedOrder);

      // Cargar ítems de public.order_items + nombre desde public.products
      const { data: itemsData } = await supabase
        .from("order_items")
        .select(
          `
          id,
          quantity,
          unit_price,
          subtotal,
          products(name)
        `,
        )
        .eq("order_id", resolvedParams.id);

      const normalizedItems: NormalizedOrderItem[] = (
        (itemsData ?? []) as unknown as OrderItemRow[]
      ).map((row) => {
        const prod = Array.isArray(row.products)
          ? row.products[0]
          : row.products;

        return {
          id: row.id,
          title: prod?.name ?? "Producto SwiftDrop",
          quantity: Number(row.quantity) || 1,
          unitPrice: Number(row.unit_price) || 0,
          subtotal: Number(row.subtotal) || 0,
        };
      });

      setItems(normalizedItems);

      // Extraer dirección y destinatario desde orders.metadata o public.profiles
      const meta =
        typedOrder.metadata && typeof typedOrder.metadata === "object"
          ? typedOrder.metadata
          : {};

      const metaName =
        typeof meta.customer_name === "string" ? meta.customer_name : null;
      const metaPhone =
        typeof meta.customer_phone === "string" ? meta.customer_phone : null;
      const metaAddress =
        typeof meta.shipping_address === "string"
          ? meta.shipping_address
          : null;

      if (metaName || metaPhone || metaAddress) {
        setShippingInfo({
          name: metaName,
          phone: metaPhone,
          address: metaAddress,
        });
      } else if (typedOrder.user_id) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("full_name, phone_number, address")
          .eq("user_id", typedOrder.user_id)
          .maybeSingle();

        if (profileData) {
          setShippingInfo({
            name: profileData.full_name ?? null,
            phone: profileData.phone_number ?? null,
            address: profileData.address ?? null,
          });
        }
      }

      setLoading(false);
    }

    void run();
  }, [resolvedParams.id]);

  const humanStatus = useMemo(() => {
    switch ((order?.status || "").toUpperCase()) {
      case "DELIVERED":
        return "Entregado";
      case "SHIPPED":
      case "FLIGHT":
        return "Enviado";
      case "CANCELLED":
      case "REFUNDED":
        return "Cancelado";
      case "PAID":
        return "Pagado";
      default:
        return "Procesando";
    }
  }, [order]);

  const isDelivered = (order?.status || "").toUpperCase() === "DELIVERED";

  const totals = useMemo(() => {
    const itemsSubtotal = items.reduce((acc, item) => acc + item.subtotal, 0);
    const meta =
      order?.metadata && typeof order.metadata === "object"
        ? order.metadata
        : {};
    const shipping = Number(meta.shipping_pesos ?? 0) || 0;
    const discount = Number(meta.discount_pesos ?? 0) || 0;
    const total = Number(order?.total_amount ?? itemsSubtotal + shipping - discount) || 0;

    return {
      subtotal: itemsSubtotal,
      shipping,
      discount,
      total,
    };
  }, [items, order]);

  const droneModel = useMemo(() => {
    if (!order?.drone_fleet) return null;
    return Array.isArray(order.drone_fleet)
      ? order.drone_fleet[0]?.model ?? null
      : order.drone_fleet.model ?? null;
  }, [order]);

  const estimatedWeightKg = useMemo(() => {
    const meta =
      order?.metadata && typeof order.metadata === "object"
        ? order.metadata
        : {};
    return typeof meta.total_weight_kg === "number"
      ? meta.total_weight_kg
      : undefined;
  }, [order]);

  function downloadInvoice() {
    if (!order) return;

    const shortOrderCode = order.id.slice(0, 8).toUpperCase();
    const doc = new jsPDF({
      unit: "pt",
      format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const black: [number, number, number] = [15, 15, 15];
    const gray: [number, number, number] = [120, 120, 120];
    const lightGray: [number, number, number] = [235, 235, 235];

    doc.setFillColor(15, 15, 15);
    doc.rect(0, 0, pageWidth, 90, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.text("SWIFTDROP", 48, 55);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("Factura / Invoice", pageWidth - 140, 55);

    doc.setTextColor(...black);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Detalles del pedido", 48, 130);

    doc.setDrawColor(...lightGray);
    doc.line(48, 142, pageWidth - 48, 142);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);

    const orderDate = new Date(order.created_at).toLocaleDateString("es-CO");
    const paymentLabel =
      order.metadata?.payment_provider === "epayco"
        ? "ePayco (simulado)"
        : "Contra entrega";

    doc.text(`Pedido: #${shortOrderCode}`, 48, 170);
    doc.text(`Fecha: ${orderDate}`, 48, 190);
    doc.text(`Estado: ${humanStatus}`, 48, 210);
    doc.text(`Método de pago: ${paymentLabel}`, 48, 230);
    doc.text(`NIT simulado: 900.123.456-7`, 48, 250);
    doc.text(`Resolución DIAN simulada: 18760000001-2024`, 48, 270);

    doc.setTextColor(...gray);
    doc.setFontSize(9);
    doc.text(
      "Este documento es una factura electrónica simulada sin validez fiscal para prototipo académico.",
      48,
      295,
    );
    doc.setTextColor(...black);
    doc.setFontSize(11);

    if (shippingInfo && (shippingInfo.name || shippingInfo.address)) {
      doc.setFont("helvetica", "bold");
      doc.text("Dirección de envío", 340, 170);
      doc.setFont("helvetica", "normal");

      const addressLines = [
        shippingInfo.name,
        shippingInfo.address,
        shippingInfo.phone,
      ].filter(Boolean);

      let y = 190;
      for (const line of addressLines) {
        const wrapped = doc.splitTextToSize(String(line), 200);
        doc.text(wrapped, 340, y);
        y += wrapped.length * 16;
      }
    }

    autoTable(doc, {
      startY: 320,
      margin: { left: 48, right: 48 },
      head: [["Producto", "Cantidad", "Subtotal"]],
      body: items.map((item) => [
        item.title,
        String(item.quantity),
        formatCOP(item.subtotal),
      ]),
      styles: {
        font: "helvetica",
        fontSize: 10,
        cellPadding: 12,
        textColor: black,
      },
      headStyles: {
        fillColor: black,
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: [248, 248, 248],
      },
      tableLineColor: lightGray,
      tableLineWidth: 0.5,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalY = ((doc as any).lastAutoTable?.finalY ?? 420) + 30;

    doc.setFillColor(250, 250, 250);
    doc.roundedRect(pageWidth - 240, finalY, 190, 100, 12, 12, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("Subtotal", pageWidth - 220, finalY + 28);
    doc.text(formatCOP(totals.subtotal), pageWidth - 70, finalY + 28, {
      align: "right",
    });

    doc.text("Envío", pageWidth - 220, finalY + 52);
    doc.text(formatCOP(totals.shipping), pageWidth - 70, finalY + 52, {
      align: "right",
    });

    doc.setDrawColor(...lightGray);
    doc.line(pageWidth - 220, finalY + 65, pageWidth - 70, finalY + 65);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Total", pageWidth - 220, finalY + 88);
    doc.text(formatCOP(totals.total), pageWidth - 70, finalY + 88, {
      align: "right",
    });

    doc.setTextColor(...gray);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Gracias por comprar en SwiftDrop.", 48, 760);
    doc.text(
      "Este documento es una representación digital de tu factura.",
      48,
      776,
    );

    doc.save(`factura-${shortOrderCode}.pdf`);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-gray-500">Cargando pedido...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6">
        <Package size={48} strokeWidth={1} className="text-gray-300" />
        <div className="text-center">
          <h1 className="text-2xl font-normal mb-2">Pedido no encontrado</h1>
          <p className="text-gray-500 text-sm">
            Este pedido no existe o fue eliminado.
          </p>
        </div>
        <Link
          href="/profile"
          className="rounded-full bg-black text-white px-6 py-3 text-xs uppercase"
        >
          Volver al perfil
        </Link>
      </div>
    );
  }

  const shortOrderCode = order.id.slice(0, 8).toUpperCase();

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-black transition-colors mb-10"
        >
          <ArrowLeft size={16} />
          Volver
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-10">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 mb-3">
              Pedido
            </p>
            <h1 className="text-3xl font-normal mb-3">#{shortOrderCode}</h1>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <Clock3 size={16} strokeWidth={1.5} />
              {formatDate(order.created_at)}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div
              className={`px-5 py-2 rounded-full text-[10px] uppercase tracking-[0.2em] border ${
                humanStatus === "Entregado"
                  ? "bg-green-50 border-green-100 text-green-700"
                  : "bg-gray-50 border-gray-100 text-gray-600"
              }`}
            >
              {humanStatus}
            </div>

            <button
              type="button"
              onClick={downloadInvoice}
              className="rounded-full bg-black text-white px-6 py-3 text-xs uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-gray-800 transition-colors"
            >
              <Download size={16} />
              Descargar factura
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 space-y-8">
            {/* TRACKING */}
            <OrderTrackingSection
              orderId={resolvedParams.id}
              fallbackVehicle={order.delivery_vehicle}
              fallbackDroneModel={droneModel}
              fallbackWeightKg={estimatedWeightKg}
            />

            {/* DELIVERY PIN */}
            <div className="border border-gray-200 rounded-3xl p-6 bg-white mt-8">
              <p className="text-[10px] uppercase tracking-[0.3em] text-gray-400 mb-3">
                Verificación de entrega
              </p>

              <h2 className="text-2xl font-light mb-3">PIN de entrega</h2>

              <p className="text-sm text-gray-500 mb-6 max-w-xl">
                Muestra este PIN al repartidor cuando llegue tu pedido. Esto
                confirma que el pedido fue entregado correctamente.
              </p>

              {isDelivered ? (
                <div className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-green-50 text-green-700 border border-green-200">
                  Pedido verificado y entregado
                </div>
              ) : (
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="text-4xl tracking-[0.4em] font-light px-8 py-5 rounded-2xl bg-black text-white">
                    {order.delivery_pin || "------"}
                  </div>

                  <div className="text-sm text-gray-500">
                    Entrégalo únicamente al repartidor.
                  </div>
                </div>
              )}
            </div>

            {/* ITEMS */}
            <div className="border border-gray-100 bg-white">
              <div className="p-8 border-b border-gray-100">
                <h2 className="text-xl font-normal">Productos</h2>
              </div>

              <div className="divide-y divide-gray-100">
                {items.length === 0 ? (
                  <div className="p-6 text-sm text-gray-500">
                    No hay productos registrados en este pedido.
                  </div>
                ) : (
                  items.map((item) => (
                    <div
                      key={item.id}
                      className="p-6 flex items-center justify-between gap-5"
                    >
                      <div className="flex items-center gap-5 min-w-0">
                        <div className="w-20 h-24 bg-[#f7f7f7] overflow-hidden shrink-0 flex items-center justify-center">
                          <Package
                            size={28}
                            strokeWidth={1}
                            className="text-gray-300"
                          />
                        </div>

                        <div className="min-w-0">
                          <h3 className="text-base font-normal mb-2">
                            {item.title}
                          </h3>
                          <p className="text-sm text-gray-500">
                            Cantidad: {item.quantity} • Unitario:{" "}
                            {formatCOP(item.unitPrice)}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="text-base">{formatCOP(item.subtotal)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* SIDEBAR */}
          <div className="lg:col-span-4 space-y-6">
            <div className="border border-gray-100 bg-white p-8">
              <h2 className="text-xl font-normal mb-8">Resumen</h2>

              <div className="space-y-5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Subtotal</span>
                  <span>{formatCOP(totals.subtotal)}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Envío</span>
                  <span>{formatCOP(totals.shipping)}</span>
                </div>

                {totals.discount > 0 && (
                  <div className="flex items-center justify-between text-green-600">
                    <span>Descuento</span>
                    <span>-{formatCOP(totals.discount)}</span>
                  </div>
                )}

                <div className="border-t border-gray-100 pt-5 flex items-center justify-between text-base">
                  <span>Total</span>
                  <span>{formatCOP(totals.total)}</span>
                </div>
              </div>
            </div>

            {shippingInfo && (shippingInfo.name || shippingInfo.address) && (
              <div className="border border-gray-100 bg-white p-8">
                <div className="flex items-center gap-3 mb-6">
                  <CheckCircle2 size={18} strokeWidth={1.5} />
                  <h2 className="text-xl font-normal">Dirección</h2>
                </div>

                <div className="space-y-2 text-sm text-gray-600 leading-relaxed">
                  {shippingInfo.name && (
                    <p className="text-black">{shippingInfo.name}</p>
                  )}
                  {shippingInfo.address && <p>{shippingInfo.address}</p>}
                  {shippingInfo.phone && (
                    <p className="pt-3">{shippingInfo.phone}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}