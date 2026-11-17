"use client";

import { Search, Mail, Calendar, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/react";

import { getSupabaseBrowserClient } from "@/src/lib/supabase/browser";
import { getAdminBootstrapSql, useAdminAccess } from "../client/useAdminAccess";
import { formatCOP } from "@/src/shared/presentation/ui";

type UserCustomerRow = {
  id: string;
  email: string;
  role: string;
  created_at: string;
  profiles?: { full_name: string | null } | Array<{ full_name: string | null }> | null;
};

type OrderAggRow = {
  user_id: string | null;
  total_amount: number | string;
};

type CustomerAggMap = Record<string, { count: number; spentPesos: number }>;

function getFullName(row: UserCustomerRow): string {
  const prof = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return prof?.full_name?.trim() || "";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0 || !parts[0]) return "?";
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

export function CustomersPage() {
  const access = useAdminAccess();
  const [customers, setCustomers] = useState<UserCustomerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [ordersByCustomer, setOrdersByCustomer] = useState<CustomerAggMap>({});

  async function load() {
    setError("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    try {
      const usersRes = await supabase
        .from("users")
        .select("id, email, role, created_at, profiles(full_name)")
        .order("created_at", { ascending: false })
        .limit(500);

      if (usersRes.error) throw usersRes.error;

      const ordersRes = await supabase
        .from("orders")
        .select("user_id, total_amount")
        .not("user_id", "is", null)
        .limit(5000);

      if (ordersRes.error) throw ordersRes.error;

      const users = (usersRes.data ?? []) as UserCustomerRow[];
      const orders = (ordersRes.data ?? []) as OrderAggRow[];

      const agg: CustomerAggMap = {};
      for (const o of orders) {
        if (!o.user_id) continue;
        if (!agg[o.user_id]) agg[o.user_id] = { count: 0, spentPesos: 0 };
        agg[o.user_id].count += 1;
        agg[o.user_id].spentPesos += Number(o.total_amount) || 0;
      }

      setCustomers(users);
      setOrdersByCustomer(agg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando clientes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.status]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const name = getFullName(c).toLowerCase();
      const email = (c.email ?? "").toLowerCase();
      const role = (c.role ?? "").toLowerCase();
      return name.includes(q) || email.includes(q) || role.includes(q);
    });
  }, [customers, query]);

  function exportCsv() {
    const headers = ["ID", "Nombre", "Email", "Rol", "Ordenes", "Total Gastado (COP)", "Fecha Registro"];
    const lines = filtered.map((c) => {
      const name = getFullName(c) || "(Sin nombre)";
      const agg = ordersByCustomer[c.id] || { count: 0, spentPesos: 0 };
      return [
        c.id,
        `"${name.replace(/"/g, '""')}"`,
        `"${(c.email ?? "").replace(/"/g, '""')}"`,
        c.role,
        String(agg.count),
        String(agg.spentPesos),
        c.created_at,
      ].join(",");
    });

    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clientes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (access.status === "missing-env") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Clientes</h2>
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
        <h2 className="text-2xl font-normal">Clientes</h2>
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
        <h2 className="text-2xl font-normal">Clientes</h2>
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
          <h2 className="text-2xl font-normal">Clientes</h2>
          <p className="text-sm text-gray-500 font-light mt-1">
            Busca y administra tu base de usuarios ({customers.length} registrados).
          </p>
        </div>
        <Button
          size="lg"
          radius="full"
          className="bg-zinc-100 text-black"
          onPress={exportCsv}
          isDisabled={filtered.length === 0}
        >
          <span>Exportar CSV</span>
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4 bg-white p-4 shadow-sm">
        <div className="relative flex-1">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            size={18}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, correo o rol..."
            className="w-full h-10 pl-12 pr-4 bg-gray-50 outline-none focus:ring-1 focus:ring-gray-200 text-sm"
          />
        </div>
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
                <th className="px-6 py-4 font-normal text-gray-500">Usuario</th>
                <th className="px-6 py-4 font-normal text-gray-500">Contacto</th>
                <th className="px-6 py-4 font-normal text-gray-500">Órdenes</th>
                <th className="px-6 py-4 font-normal text-gray-500">Total Gastado</th>
                <th className="px-6 py-4 font-normal text-gray-500">Rol</th>
                <th className="px-6 py-4 font-normal text-gray-500 text-right">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                    Cargando clientes…
                  </td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                    No hay clientes registrados.
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((customer) => {
                  const fullName = getFullName(customer);
                  const displayName = fullName || customer.email || "(Sin nombre)";
                  const agg = ordersByCustomer[customer.id] || {
                    count: 0,
                    spentPesos: 0,
                  };
                  const roleBadgeClass =
                    customer.role === "ADMIN"
                      ? "bg-purple-50 text-purple-700"
                      : customer.role === "WHOLESALE"
                        ? "bg-blue-50 text-blue-700"
                        : "bg-emerald-50 text-emerald-700";

                  return (
                    <tr
                      key={customer.id}
                      className="group transition-colors hover:bg-gray-50/50"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center font-medium shrink-0">
                            {initials(displayName)}
                          </div>
                          <Link
                            href={`/admin/customers/${customer.id}`}
                            className="font-medium hover:underline"
                          >
                            {displayName}
                          </Link>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          {customer.email && (
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <Mail size={12} /> {customer.email}
                            </div>
                          )}
                          {customer.created_at && (
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <Calendar size={12} />
                              {new Intl.DateTimeFormat("es-CO", {
                                year: "numeric",
                                month: "short",
                                day: "2-digit",
                              }).format(new Date(customer.created_at))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {agg.count} {agg.count === 1 ? "orden" : "órdenes"}
                      </td>
                      <td className="px-6 py-4 font-medium">
                        {formatCOP(Math.round(agg.spentPesos * 100))}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${roleBadgeClass}`}
                        >
                          {customer.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/admin/customers/${customer.id}`}
                          className="inline-flex items-center gap-1 text-xs uppercase text-gray-400 hover:text-black transition-colors"
                        >
                          <span>Ver</span>
                          <ExternalLink size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}