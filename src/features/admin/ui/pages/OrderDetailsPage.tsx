"use client";

import { StatusBadge } from "../components/StatusBadge";
import {
  ArrowLeft,
  MapPin,
  CreditCard,
  Calendar,
  Printer,
  Package,
  User,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { cn, Button } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/src/lib/supabase/browser";
import { getAdminBootstrapSql, useAdminAccess } from "../client/useAdminAccess";
import { formatCOP } from "@/src/shared/presentation/ui";

type ProfileData = {
  full_name?: string | null;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
};

type UserRel = {
  id: string;
  email: string | null;
  role?: string | null;
  profiles?: ProfileData | ProfileData[] | null;
};

type ProductRel = {
  id: string;
  name: string;
  weight_kg?: number | string | null;
  image_url?: string | null;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  quantity: number;
  unit_price: number | string;
  subtotal?: number | string | null;
  product?: ProductRel | ProductRel[] | null;
};

type OrderDetailRow = {
  id: string;
  user_id: string | null;
  status: string;
  total_amount: number | string;
  shipping_cost?: number | string | null;
  shipping_address?: string | null;
  payment_method?: string | null;
  created_at: string;
  user?: UserRel | UserRel[] | null;
  order_items?: OrderItemRow[] | null;
};

const ORDER_STATUSES = [
  "Pendiente",
  "Procesando",
  "Preparado",
  "Enviado",
  "Entregado",
  "Cancelado",
] as const;

function formatOrderId(id: string) {
  return `#ORD-${id.slice(0, 8).toUpperCase()}`;
}

function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat("es-CO", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function extractUser(order: OrderDetailRow | null): {
  id: string | null;
  name: string;
  email: string;
  phone: string;
  role: string;
  profileAddress: string;
} {
  if (!order) {
    return { id: null, name: "(Sin cliente)", email: "", phone: "-", role: "", profileAddress: "" };
  }
  const u = Array.isArray(order.user) ? order.user[0] : order.user;
  if (!u) {
    return {
      id: order.user_id,
      name: "(Sin cliente)",
      email: "",
      phone: "-",
      role: "",
      profileAddress: "",
    };
  }
  const prof = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
  const fullName = prof?.full_name?.trim() || "";
  const email = u.email?.trim() || "";
  const profileAddress = [prof?.address, prof?.city].filter(Boolean).join(", ");

  return {
    id: u.id || order.user_id,
    name: fullName || email || "(Sin cliente)",
    email,
    phone: prof?.phone?.trim() || "-",
    role: u.role || "",
    profileAddress,
  };
}

function getProduct(item: OrderItemRow): ProductRel | null {
  if (!item.product) return null;
  return Array.isArray(item.product) ? (item.product[0] ?? null) : item.product;
}

function buildTimeline(order: OrderDetailRow) {
  const normalized = (order.status || "").toLowerCase();
  const isCancelled = normalized === "cancelado" || normalized === "cancelled";

  if (isCancelled) {
    return [
      { label: "Orden Realizada", active: true, detail: fmtDateTime(order.created_at) },
      { label: "Orden Cancelada", active: true, detail: "Cancelada" },
    ];
  }

  const rankMap: Record<string, number> = {
    pendiente: 1,
    pending: 1,
    procesando: 2,
    processing: 2,
    preparado: 3,
    fulfilled: 3,
    enviado: 4,
    shipped: 4,
    entregado: 5,
    delivered: 5,
  };
  const currentRank = rankMap[normalized] ?? 1;

  return [
    {
      label: "Orden Realizada",
      active: currentRank >= 1,
      detail: fmtDateTime(order.created_at),
    },
    {
      label: "Procesando Pago",
      active: currentRank >= 2,
      detail: currentRank >= 2 ? "Confirmado" : "Pendiente",
    },
    {
      label: "Preparación",
      active: currentRank >= 3,
      detail: currentRank >= 3 ? "Listo para despacho" : "Pendiente",
    },
    {
      label: "Enviado",
      active: currentRank >= 4,
      detail: currentRank >= 4 ? "En tránsito" : "Pendiente",
    },
    {
      label: "Entregado",
      active: currentRank >= 5,
      detail: currentRank >= 5 ? "Completado" : "Pendiente",
    },
  ];
}

export function OrderDetailsPage(_props: {
  params?: Promise<{ id: string }> | { id: string };
}) {
  const access = useAdminAccess();
  const routeParams = useParams<{ id?: string }>();
  const orderId = typeof routeParams?.id === "string" ? routeParams.id : null;

  const [order, setOrder] = useState<OrderDetailRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setError("");
    if (!orderId || access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from("orders")
        .select(
          "*, user:users(id, email, role, profiles(*)), order_items(*, product:products(*))",
        )
        .eq("id", orderId)
        .single();

      if (fetchErr) throw fetchErr;
      setOrder((data ?? null) as OrderDetailRow | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando la orden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.status, orderId]);

  async function handleStatusChange(nextStatus: string) {
    setError("");
    setSuccess("");
    if (!order || access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setUpdatingStatus(true);
    try {
      const { data: updated, error: updErr } = await supabase
        .from("orders")
        .update({ status: nextStatus })
        .eq("id", order.id)
        .select("id, status")
        .maybeSingle();

      if (updErr) throw updErr;
      if (!updated) {
        throw new Error(
          "No se pudo actualizar el estado. Verifica las políticas RLS de UPDATE en public.orders.",
        );
      }

      setOrder((prev) => (prev ? { ...prev, status: nextStatus } : prev));
      setSuccess(`Estado actualizado a "${nextStatus}".`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Error actualizando estado de la orden",
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  const items = useMemo(() => order?.order_items ?? [], [order]);
  const itemsCount = useMemo(
    () => items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0),
    [items],
  );
  const timeline = useMemo(() => (order ? buildTimeline(order) : []), [order]);

  if (access.status === "missing-env") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Detalle de Orden</h2>
        <p className="mt-2 text-sm text-gray-600">{access.message}</p>
      </div>
    );
  }

  if (access.status === "loading") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-600">Cargando…</p>
      </div>
    );
  }

  if (access.status === "unauthenticated") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Detalle de Orden</h2>
        <p className="mt-2 text-sm text-gray-600">
          Inicia sesión para acceder al panel de admin.
        </p>
        <p className="mt-2 text-xs text-gray-400">
          Usa el login del storefront (header).
        </p>
      </div>
    );
  }

  if (access.status === "forbidden") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Detalle de Orden</h2>
        <p className="mt-2 text-sm text-gray-600">
          Tu usuario no tiene permisos de admin.
        </p>
        <p className="mt-4 text-xs text-gray-500">
          Ejecuta esto en Supabase SQL Editor:
        </p>
        <pre className="mt-2 bg-gray-50 p-4 text-xs overflow-auto">
          {getAdminBootstrapSql(access.userId)}
        </pre>
      </div>
    );
  }

  if (loading && !order) {
    return (
      <div className="bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-600">Cargando orden…</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Detalle de Orden</h2>
        <p className="mt-2 text-sm text-gray-600">No se encontró la orden.</p>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  const displayId = formatOrderId(order.id);
  const customer = extractUser(order);
  const shippingAddress =
    order.shipping_address?.trim() ||
    customer.profileAddress ||
    "Sin dirección de envío registrada";

  const itemsSubtotalPesos = items.reduce((sum, item) => {
    const sub =
      item.subtotal !== null && item.subtotal !== undefined
        ? Number(item.subtotal)
        : (Number(item.unit_price) || 0) * (Number(item.quantity) || 0);
    return sum + sub;
  }, 0);

  const shippingPesos = Number(order.shipping_cost) || 0;
  const totalPesos =
    Number(order.total_amount) || itemsSubtotalPesos + shippingPesos;
  const subtotalDisplayPesos =
    itemsSubtotalPesos > 0
      ? itemsSubtotalPesos
      : Math.max(0, totalPesos - shippingPesos);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/orders"
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-normal">Orden {displayId}</h2>
              <StatusBadge status={order.status} />
            </div>
            <p className="text-sm text-gray-500 font-light mt-1">
              {fmtDateTime(order.created_at)} · {itemsCount}{" "}
              {itemsCount === 1 ? "Ítem" : "Ítems"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={order.status}
            disabled={updatingStatus}
            onChange={(e) => void handleStatusChange(e.target.value)}
            className="h-11 px-4 rounded-full bg-white border border-gray-200 text-sm outline-none focus:border-black cursor-pointer"
          >
            {ORDER_STATUSES.map((st) => (
              <option key={st} value={st}>
                Estado: {st}
              </option>
            ))}
          </select>

          <Button
            size="lg"
            radius="full"
            className="bg-zinc-100 text-black"
            onPress={() => window.print()}
          >
            <Printer size={16} />
            <span>Imprimir</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Items & Payment */}
        <div className="lg:col-span-2 space-y-6">
          {/* Items */}
          <div className="bg-white p-6 shadow-sm">
            <h3 className="text-lg font-normal mb-6">Ítems de Orden</h3>
            {items.length === 0 ? (
              <p className="text-sm text-gray-500">
                Esta orden no tiene ítems detallados.
              </p>
            ) : (
              <div className="space-y-6">
                {items.map((item) => {
                  const prod = getProduct(item);
                  const unitPricePesos = Number(item.unit_price) || 0;
                  const lineTotalPesos =
                    item.subtotal !== null && item.subtotal !== undefined
                      ? Number(item.subtotal)
                      : unitPricePesos * (Number(item.quantity) || 0);

                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 border-b border-gray-50 pb-4 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="h-16 w-16 shrink-0 overflow-hidden bg-gray-100 flex items-center justify-center text-gray-400">
                          {prod?.image_url ? (
                            <img
                              src={prod.image_url}
                              alt={prod.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Package size={20} />
                          )}
                        </div>
                        <div className="min-w-0">
                          {prod ? (
                            <Link
                              href={`/admin/products/${prod.id}`}
                              className="font-medium text-sm hover:underline block truncate"
                            >
                              {prod.name}
                            </Link>
                          ) : (
                            <h4 className="font-medium text-sm">
                              Producto eliminado
                            </h4>
                          )}
                          <p className="text-gray-500 text-xs mt-1">
                            Unitario:{" "}
                            {formatCOP(Math.round(unitPricePesos * 100))}
                            {prod?.weight_kg ? ` · ${prod.weight_kg} kg` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="font-medium text-sm">
                          {formatCOP(Math.round(lineTotalPesos * 100))}
                        </p>
                        <p className="text-gray-500 text-xs mt-1">
                          Cant: {item.quantity}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-6 border-t border-gray-100 pt-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span>
                  {formatCOP(Math.round(subtotalDisplayPesos * 100))}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Envío</span>
                <span>{formatCOP(Math.round(shippingPesos * 100))}</span>
              </div>
              <div className="flex justify-between text-base font-medium pt-2 border-t border-gray-100">
                <span>Total</span>
                <span>{formatCOP(Math.round(totalPesos * 100))}</span>
              </div>
            </div>
          </div>

          {/* Payment & Shipping info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 shadow-sm">
              <h3 className="text-base font-normal mb-4 flex items-center gap-2">
                <MapPin size={18} className="text-gray-400" />
                Dirección de Envío
              </h3>
              <div className="text-sm text-gray-600 leading-relaxed">
                <p className="font-medium text-black mb-1">{customer.name}</p>
                <p>{shippingAddress}</p>
              </div>
            </div>

            <div className="bg-white p-6 shadow-sm">
              <h3 className="text-base font-normal mb-4 flex items-center gap-2">
                <CreditCard size={18} className="text-gray-400" />
                Detalles de Pago
              </h3>
              <div className="text-sm text-gray-600 space-y-3">
                <div className="flex justify-between">
                  <span>Método</span>
                  <span className="text-black font-medium">
                    {order.payment_method || "Pasarela Online"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Referencia</span>
                  <span className="text-black font-mono text-xs">
                    {order.id.slice(0, 13).toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Fecha</span>
                  <span className="text-black font-medium">
                    {fmtDateTime(order.created_at)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Customer & Timeline */}
        <div className="space-y-6">
          {/* Customer Card */}
          <div className="bg-white p-6 shadow-sm">
            <h3 className="text-lg font-normal mb-4 flex items-center gap-2">
              <User size={18} className="text-gray-400" />
              Cliente
            </h3>
            <div className="flex items-center gap-4 mb-6">
              <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center text-lg font-medium shrink-0">
                {customer.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                {customer.id ? (
                  <Link
                    href={`/admin/customers/${customer.id}`}
                    className="font-medium hover:underline block truncate"
                  >
                    {customer.name}
                  </Link>
                ) : (
                  <p className="font-medium truncate">{customer.name}</p>
                )}
                {customer.role && (
                  <p className="text-xs text-gray-500">{customer.role}</p>
                )}
              </div>
            </div>
            <div className="space-y-3 text-sm border-t border-gray-100 pt-4">
              <div className="flex items-center gap-3 text-gray-600">
                <span className="w-20 text-gray-400 shrink-0">Email</span>
                <span className="truncate">{customer.email || "-"}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <span className="w-20 text-gray-400 shrink-0">Teléfono</span>
                <span>{customer.phone}</span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-white p-6 shadow-sm">
            <h3 className="text-lg font-normal mb-6 flex items-center gap-2">
              <Calendar size={18} className="text-gray-400" />
              Cronología
            </h3>
            <div className="relative pl-4 border-l border-gray-100 space-y-6">
              {timeline.map((event, index) => (
                <div key={index} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[21px] top-1.5 h-3 w-3 rounded-full border-2 bg-white",
                      event.active ? "border-black" : "border-gray-200",
                    )}
                  />
                  <p
                    className={cn(
                      "text-sm font-medium",
                      event.active ? "text-black" : "text-gray-400",
                    )}
                  >
                    {event.label}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{event.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}