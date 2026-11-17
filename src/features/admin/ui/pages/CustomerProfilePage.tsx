"use client";

import { StatusBadge } from "../components/StatusBadge";
import { ArrowLeft, Mail, Phone, MapPin, ShoppingBag, Shield } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/src/lib/supabase/browser";
import { getAdminBootstrapSql, useAdminAccess } from "../client/useAdminAccess";
import { formatCOP } from "@/src/shared/presentation/ui";

type ProfileData = {
  full_name?: string | null;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  loyalty_points?: number | null;
};

type UserRecord = {
  id: string;
  email: string;
  role: string;
  created_at: string;
  profiles?: ProfileData | ProfileData[] | null;
};

type OrderListRow = {
  id: string;
  user_id: string;
  created_at: string;
  status: string;
  total_amount: number | string;
  shipping_address?: string | null;
};

type OrderItemRow = {
  order_id: string;
  quantity: number;
};

type ItemCountMap = Record<string, number>;

function extractProfile(user: UserRecord | null): ProfileData | null {
  if (!user?.profiles) return null;
  return Array.isArray(user.profiles) ? (user.profiles[0] ?? null) : user.profiles;
}

function formatOrderId(id: string) {
  return `#ORD-${id.slice(0, 8).toUpperCase()}`;
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("es-CO", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(iso));
}

export function CustomerProfilePage(_props: {
  params?: Promise<{ id: string }> | { id: string };
}) {
  const access = useAdminAccess();
  const routeParams = useParams<{ id?: string }>();
  const customerId = typeof routeParams?.id === "string" ? routeParams.id : null;

  const [user, setUser] = useState<UserRecord | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("MINORISTA");
  const [orders, setOrders] = useState<OrderListRow[]>([]);
  const [itemCounts, setItemCounts] = useState<ItemCountMap>({});
  const [loading, setLoading] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const stats = useMemo(() => {
    const totalPesos = orders.reduce(
      (sum, o) => sum + (Number(o.total_amount) || 0),
      0,
    );
    const count = orders.length;
    const avgPesos = count > 0 ? totalPesos / count : 0;
    return {
      totalCents: Math.round(totalPesos * 100),
      count,
      avgCents: Math.round(avgPesos * 100),
    };
  }, [orders]);

  async function load() {
    setError("");
    setSuccess("");
    if (!customerId) return;
    if (access.status !== "ready") return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    try {
      const userRes = await supabase
        .from("users")
        .select("id, email, role, created_at, profiles(*)")
        .eq("id", customerId)
        .single();

      if (userRes.error) throw userRes.error;

      const ordersRes = await supabase
        .from("orders")
        .select("*")
        .eq("user_id", customerId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (ordersRes.error) throw ordersRes.error;

      const u = userRes.data as UserRecord;
      const ords = (ordersRes.data ?? []) as OrderListRow[];

      setUser(u);
      setSelectedRole(u.role || "MINORISTA");
      setOrders(ords);

      if (ords.length > 0) {
        const orderIds = ords.map((o) => o.id);
        const itemsRes = await supabase
          .from("order_items")
          .select("order_id, quantity")
          .in("order_id", orderIds);

        if (!itemsRes.error && itemsRes.data) {
          const counts: ItemCountMap = {};
          for (const item of itemsRes.data as OrderItemRow[]) {
            counts[item.order_id] =
              (counts[item.order_id] ?? 0) + (Number(item.quantity) || 0);
          }
          setItemCounts(counts);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando cliente");
    } finally {
      setLoading(false);
    }
  }

  async function saveRole() {
    setError("");
    setSuccess("");
    if (access.status !== "ready" || !user) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setSavingRole(true);
    try {
      const { data: updated, error: updErr } = await supabase
        .from("users")
        .update({ role: selectedRole })
        .eq("id", user.id)
        .select("id, role")
        .maybeSingle();

      if (updErr) throw updErr;
      if (!updated) {
        throw new Error(
          "No se pudo actualizar el rol. Verifica las políticas RLS de UPDATE en public.users.",
        );
      }

      setUser((prev) => (prev ? { ...prev, role: selectedRole } : prev));
      setSuccess("Rol actualizado correctamente.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error actualizando el rol");
    } finally {
      setSavingRole(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.status, customerId]);

  if (access.status === "missing-env") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Perfil de Cliente</h2>
        <p className="mt-2 text-sm text-gray-600">{access.message}</p>
      </div>
    );
  }

  if (access.status === "loading") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-600">Cargando...</p>
      </div>
    );
  }

  if (access.status === "unauthenticated") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Perfil de Cliente</h2>
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
        <h2 className="text-2xl font-normal">Perfil de Cliente</h2>
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

  if (loading && !user) {
    return (
      <div className="bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-600">Cargando cliente...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Perfil de Cliente</h2>
        <p className="mt-2 text-sm text-gray-600">No se encontró el cliente.</p>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  const profile = extractProfile(user);
  const name = profile?.full_name?.trim() || user.email || "(Sin nombre)";
  const memberSince = new Intl.DateTimeFormat("es-CO", {
    year: "numeric",
    month: "short",
  }).format(new Date(user.created_at));

  const latestShippingAddress = orders.find((o) => o.shipping_address)?.shipping_address;
  const addressDisplay =
    [profile?.address, profile?.city].filter(Boolean).join(", ") ||
    latestShippingAddress ||
    "Sin dirección registrada";

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link
          href="/admin/customers"
          className="p-2 rounded-full hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <h2 className="text-2xl font-normal">Perfil de Cliente</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Sidebar Profile */}
        <div className="space-y-6">
          <div className="bg-white p-8 shadow-sm text-center">
            <div className="mx-auto h-24 w-24 rounded-full bg-gray-100 flex items-center justify-center text-2xl font-medium mb-4">
              {name.slice(0, 2).toUpperCase()}
            </div>
            <h3 className="text-xl font-normal">{name}</h3>
            <p className="text-sm text-gray-500 mb-6">Miembro desde {memberSince}</p>

            <div className="flex justify-center gap-2 mb-6">
              <StatusBadge status={user.role} />
            </div>

            <div className="border-t border-gray-100 pt-6 space-y-4 text-left">
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <Mail size={16} className="text-gray-400 shrink-0" />
                <span className="truncate">{user.email || "-"}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <Phone size={16} className="text-gray-400 shrink-0" />
                <span>{profile?.phone || "-"}</span>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-600">
                <MapPin size={16} className="text-gray-400 mt-0.5 shrink-0" />
                <span>{addressDisplay}</span>
              </div>
            </div>
          </div>

          {/* Role Management */}
          <div className="bg-white p-6 shadow-sm space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <Shield size={16} className="text-gray-400" />
              <span>Rol del Usuario</span>
            </h4>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full h-11 px-3 text-sm bg-gray-50 border border-gray-200 outline-none focus:border-black"
            >
              <option value="MINORISTA">MINORISTA</option>
              <option value="MAYORISTA">MAYORISTA</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <Button
              size="lg"
              radius="full"
              className="bg-black text-white w-full"
              isDisabled={savingRole || selectedRole === user.role}
              onPress={() => void saveRole()}
            >
              {savingRole ? "Guardando..." : "Actualizar Rol"}
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-6 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">Total Gastado</p>
              <p className="text-2xl font-normal">{formatCOP(stats.totalCents)}</p>
            </div>
            <div className="bg-white p-6 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">Órdenes</p>
              <p className="text-2xl font-normal">{stats.count}</p>
            </div>
            <div className="bg-white p-6 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">Promedio por Orden</p>
              <p className="text-2xl font-normal">{formatCOP(stats.avgCents)}</p>
            </div>
          </div>

          {/* Order History */}
          <div className="bg-white p-6 shadow-sm">
            <h3 className="text-lg font-normal mb-6 flex items-center gap-2">
              <ShoppingBag size={18} className="text-gray-400" />
              <span>Historial de Compras</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-100">
                  <tr>
                    <th className="pb-3 font-normal text-gray-500">Orden</th>
                    <th className="pb-3 font-normal text-gray-500">Fecha</th>
                    <th className="pb-3 font-normal text-gray-500">Artículos</th>
                    <th className="pb-3 font-normal text-gray-500">Total</th>
                    <th className="pb-3 font-normal text-gray-500">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {orders.length === 0 && (
                    <tr>
                      <td className="py-6 text-sm text-gray-500" colSpan={5}>
                        Este cliente aún no tiene órdenes.
                      </td>
                    </tr>
                  )}

                  {orders.map((order) => {
                    const qty = itemCounts[order.id];
                    return (
                      <tr
                        key={order.id}
                        className="group hover:bg-gray-50/50 transition-colors"
                      >
                        <td className="py-4 font-medium text-black">
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="hover:underline"
                          >
                            {formatOrderId(order.id)}
                          </Link>
                        </td>
                        <td className="py-4 text-gray-500">
                          {fmtDate(order.created_at)}
                        </td>
                        <td className="py-4 text-gray-500">
                          {typeof qty === "number"
                            ? `${qty} ${qty === 1 ? "artículo" : "artículos"}`
                            : "—"}
                        </td>
                        <td className="py-4 font-medium">
                          {formatCOP(
                            Math.round((Number(order.total_amount) || 0) * 100),
                          )}
                        </td>
                        <td className="py-4">
                          <StatusBadge status={order.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
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
    </div>
  );
}