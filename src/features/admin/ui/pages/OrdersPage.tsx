"use client";

import { StatusBadge } from "../components/StatusBadge";
import { Search, Filter, MoreHorizontal, Eye } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useRef } from "react";
import { cn, Button } from "@heroui/react";

import { getSupabaseBrowserClient } from "@/src/lib/supabase/browser";
import { getAdminBootstrapSql, useAdminAccess } from "../client/useAdminAccess";
import { formatCOP } from "@/src/shared/presentation/ui";

type UserProfileRel = {
  full_name: string | null;
};

type OrderUserRel = {
  id: string;
  email: string | null;
  profiles?: UserProfileRel | UserProfileRel[] | null;
};

type OrderRow = {
  id: string;
  user_id: string | null;
  status: string;
  total_amount: number | string;
  created_at: string;
  user?: OrderUserRel | OrderUserRel[] | null;
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

function formatDate(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("es-CO", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(d);
}

function extractCustomerInfo(order: OrderRow): {
  id: string | null;
  name: string;
  email: string;
} {
  const u = Array.isArray(order.user) ? order.user[0] : order.user;
  if (!u) {
    return {
      id: order.user_id,
      name: "(Sin cliente)",
      email: "",
    };
  }
  const prof = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
  const fullName = prof?.full_name?.trim() || "";
  const email = u.email?.trim() || "";
  return {
    id: u.id || order.user_id,
    name: fullName || email || "(Sin cliente)",
    email,
  };
}

export function OrdersPage() {
  const access = useAdminAccess();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setError("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from("orders")
        .select(
          "id, user_id, status, total_amount, created_at, user:users(id, email, profiles(full_name))",
        )
        .order("created_at", { ascending: false })
        .limit(300);

      if (fetchErr) throw fetchErr;
      setRows((data ?? []) as OrderRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando órdenes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.status]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((o) => {
      if (
        statusFilter !== "ALL" &&
        o.status.toLowerCase() !== statusFilter.toLowerCase()
      ) {
        return false;
      }
      if (!q) return true;
      const customer = extractCustomerInfo(o);
      const displayId = formatOrderId(o.id).toLowerCase();
      return (
        displayId.includes(q) ||
        o.id.toLowerCase().includes(q) ||
        customer.name.toLowerCase().includes(q) ||
        customer.email.toLowerCase().includes(q) ||
        o.status.toLowerCase().includes(q)
      );
    });
  }, [rows, query, statusFilter]);

  async function handleStatusChange(orderId: string, nextStatus: string) {
    setError("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setUpdatingId(orderId);
    try {
      const { data: updated, error: updErr } = await supabase
        .from("orders")
        .update({ status: nextStatus })
        .eq("id", orderId)
        .select("id, status")
        .maybeSingle();

      if (updErr) throw updErr;
      if (!updated) {
        throw new Error(
          "No se pudo actualizar el estado. Verifica las políticas RLS de UPDATE en public.orders.",
        );
      }

      setRows((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o)),
      );
      setOpenMenuId(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Error actualizando estado de la orden",
      );
    } finally {
      setUpdatingId(null);
    }
  }

  function exportCsv() {
    const headers = [
      "ID Orden",
      "UUID",
      "Cliente",
      "Email",
      "Fecha",
      "Estado",
      "Total (COP)",
    ];
    const lines = filtered.map((o) => {
      const customer = extractCustomerInfo(o);
      return [
        formatOrderId(o.id),
        o.id,
        `"${customer.name.replace(/"/g, '""')}"`,
        `"${customer.email.replace(/"/g, '""')}"`,
        o.created_at,
        o.status,
        String(Number(o.total_amount) || 0),
      ].join(",");
    });

    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ordenes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (access.status === "missing-env") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Órdenes</h2>
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
        <h2 className="text-2xl font-normal">Órdenes</h2>
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
        <h2 className="text-2xl font-normal">Órdenes</h2>
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

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-normal">Órdenes</h2>
          <p className="text-sm text-gray-500 font-light mt-1">
            Administra y rastrea las órdenes de tus clientes ({rows.length} registradas).
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="lg"
            radius="full"
            className={cn(
              showFilters || statusFilter !== "ALL"
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-black",
            )}
            onPress={() => setShowFilters((prev) => !prev)}
          >
            <Filter size={16} />
            <span>
              {statusFilter === "ALL" ? "Filtrar" : `Estado: ${statusFilter}`}
            </span>
          </Button>
          <Button
            size="lg"
            radius="full"
            className="bg-black text-white"
            isDisabled={filtered.length === 0}
            onPress={exportCsv}
          >
            Exportar
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white p-4 shadow-sm space-y-4">
        <div className="relative flex-1">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            size={18}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por ID de orden, cliente, correo o estado..."
            className="w-full h-10 pl-12 pr-4 bg-gray-50 outline-none focus:ring-1 focus:ring-gray-200 text-sm"
          />
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setStatusFilter("ALL")}
              className={cn(
                "px-3 py-1 rounded-full text-xs transition-colors",
                statusFilter === "ALL"
                  ? "bg-black text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200",
              )}
            >
              Todos
            </button>
            {ORDER_STATUSES.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs transition-colors",
                  statusFilter === st
                    ? "bg-black text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                )}
              >
                {st}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/50">
              <tr>
                <th className="px-6 py-4 font-normal text-gray-500">ID Orden</th>
                <th className="px-6 py-4 font-normal text-gray-500">Cliente</th>
                <th className="px-6 py-4 font-normal text-gray-500">Fecha</th>
                <th className="px-6 py-4 font-normal text-gray-500">Estado</th>
                <th className="px-6 py-4 font-normal text-gray-500 text-right">
                  Total
                </th>
                <th className="px-6 py-4 font-normal text-gray-500 text-center">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                    Cargando órdenes…
                  </td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                    No hay órdenes que coincidan con el filtro.
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((order) => {
                  const displayId = formatOrderId(order.id);
                  const customer = extractCustomerInfo(order);
                  const date = formatDate(order.created_at);
                  const totalCents = Math.round(
                    (Number(order.total_amount) || 0) * 100,
                  );

                  return (
                    <tr
                      key={order.id}
                      className="group transition-colors hover:bg-gray-50/50"
                    >
                      <td className="px-6 py-4 font-medium">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="hover:underline"
                        >
                          {displayId}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        {customer.id ? (
                          <Link
                            href={`/admin/customers/${customer.id}`}
                            className="hover:underline"
                          >
                            {customer.name}
                          </Link>
                        ) : (
                          <span>{customer.name}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-500">{date}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="px-6 py-4 text-right font-medium">
                        {formatCOP(totalCents)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2 relative">
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="p-2 text-gray-400 hover:text-black transition-colors rounded-full hover:bg-gray-100"
                            title="Ver Detalles"
                          >
                            <Eye size={18} />
                          </Link>
                          <div
                            ref={openMenuId === order.id ? menuRef : undefined}
                            className="relative"
                          >
                            <button
                              className="p-2 text-gray-400 hover:text-black transition-colors rounded-full hover:bg-gray-100"
                              type="button"
                              onClick={() =>
                                setOpenMenuId(
                                  openMenuId === order.id ? null : order.id,
                                )
                              }
                            >
                              <MoreHorizontal size={18} />
                            </button>
                            {openMenuId === order.id && (
                              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-100 shadow-lg rounded-lg z-50 py-1">
                                <p className="px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
                                  Cambiar estado
                                </p>
                                {ORDER_STATUSES.map((st) => {
                                  const isCurrent =
                                    order.status.toLowerCase() ===
                                    st.toLowerCase();
                                  return (
                                    <button
                                      key={st}
                                      type="button"
                                      disabled={
                                        updatingId === order.id || isCurrent
                                      }
                                      className={cn(
                                        "w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors",
                                        isCurrent
                                          ? "text-gray-400 cursor-default"
                                          : "text-gray-700",
                                      )}
                                      onClick={() => {
                                        if (!isCurrent) {
                                          void handleStatusChange(order.id, st);
                                        }
                                      }}
                                    >
                                      {updatingId === order.id
                                        ? "Actualizando..."
                                        : st}
                                      {isCurrent && (
                                        <span className="ml-2 text-xs text-gray-400">
                                          (actual)
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4 text-sm text-gray-500">
          <span>
            Mostrando {filtered.length} de {rows.length} órdenes
          </span>
          <button
            className="px-3 py-1 rounded-lg hover:bg-gray-100"
            type="button"
            onClick={() => void load()}
          >
            Actualizar
          </button>
        </div>
      </div>
    </div>
  );
}