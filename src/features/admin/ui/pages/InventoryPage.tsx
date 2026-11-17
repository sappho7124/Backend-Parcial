"use client";

import { StatusBadge } from "../components/StatusBadge";
import { Search, RotateCw, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { cn, Button } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/src/lib/supabase/browser";
import { getAdminBootstrapSql, useAdminAccess } from "../client/useAdminAccess";
import { formatCOP } from "@/src/shared/presentation/ui";

const BOOT_KEY = "swiftdrop_admin_booted_v1";
const LOW_STOCK_THRESHOLD = 5;

type ProductInventoryRow = {
  id: string;
  name: string;
  price: number | string;
  weight_kg: number | string;
  stock: number;
};

export function InventoryPage() {
  const access = useAdminAccess();
  const [booted, setBooted] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.sessionStorage.getItem(BOOT_KEY) === "1";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!booted && access.status !== "loading") {
      try {
        window.sessionStorage.setItem(BOOT_KEY, "1");
      } catch {}
      setBooted(true);
    }
  }, [access.status, booted]);

  const [rows, setRows] = useState<ProductInventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [deltaByProduct, setDeltaByProduct] = useState<Record<string, string>>({});

  async function load() {
    setError("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from("products")
        .select("id, name, price, weight_kg, stock")
        .order("stock", { ascending: true })
        .order("name", { ascending: true })
        .limit(500);

      if (fetchErr) throw fetchErr;
      setRows((data ?? []) as ProductInventoryRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando inventario");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.status]);

  const lowStockCount = useMemo(() => {
    return rows.filter((p) => (p.stock ?? 0) <= LOW_STOCK_THRESHOLD).length;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((p) => {
      const stock = p.stock ?? 0;
      if (onlyLowStock && stock > LOW_STOCK_THRESHOLD) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    });
  }, [rows, query, onlyLowStock]);

  async function applyDelta(product: ProductInventoryRow) {
    setError("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const raw = (deltaByProduct[product.id] ?? "").trim();
    if (!raw) {
      setError("Ingresa un ajuste numérico. Ej: 10 o -2");
      return;
    }

    const delta = Number(raw);
    if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
      setError("Ingresa un número entero válido. Ej: 5 o -2");
      return;
    }

    const current = Number(product.stock) || 0;
    const next = Math.max(0, current + delta);

    setUpdatingId(product.id);
    try {
      const { data: updated, error: updErr } = await supabase
        .from("products")
        .update({ stock: next })
        .eq("id", product.id)
        .select("id, stock")
        .maybeSingle();

      if (updErr) throw updErr;
      if (!updated) {
        throw new Error(
          "No se actualizó el stock. Verifica las políticas RLS de UPDATE en public.products.",
        );
      }

      setDeltaByProduct((p) => ({ ...p, [product.id]: "" }));
      setRows((prev) =>
        prev.map((item) =>
          item.id === product.id ? { ...item, stock: next } : item,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error actualizando stock");
    } finally {
      setUpdatingId(null);
    }
  }

  if (access.status === "missing-env") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Inventario</h2>
        <p className="mt-2 text-sm text-gray-600">{access.message}</p>
      </div>
    );
  }

  if (access.status === "loading" && !booted) {
    return (
      <div className="bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-600">Cargando…</p>
      </div>
    );
  }

  if (access.status === "unauthenticated") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Inventario</h2>
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
        <h2 className="text-2xl font-normal">Inventario</h2>
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
          <h2 className="text-2xl font-normal">Inventario</h2>
          <p className="text-sm text-gray-500 font-light mt-1">
            Gestiona los niveles de stock disponibles en el catálogo ({rows.length} productos).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            radius="full"
            className="bg-zinc-100 text-black"
            isDisabled={loading}
            onPress={() => void load()}
          >
            <RotateCw size={16} className={cn(loading && "animate-spin")} />
            <span>Sincronizar Stock</span>
          </Button>
          <Button
            size="lg"
            radius="full"
            className={cn(
              onlyLowStock
                ? "bg-amber-500 text-white"
                : "bg-zinc-100 text-black",
            )}
            onPress={() => setOnlyLowStock((prev) => !prev)}
          >
            <AlertTriangle
              size={16}
              className={cn(onlyLowStock ? "text-white" : "text-amber-500")}
            />
            <span>Alerta Stock Bajo ({lowStockCount})</span>
          </Button>
        </div>
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
            placeholder="Buscar por nombre o ID de producto..."
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
                <th className="px-6 py-4 font-normal text-gray-500">Producto</th>
                <th className="px-6 py-4 font-normal text-gray-500">Precio</th>
                <th className="px-6 py-4 font-normal text-gray-500">Peso</th>
                <th className="px-6 py-4 font-normal text-gray-500 text-center">
                  Stock Actual
                </th>
                <th className="px-6 py-4 font-normal text-gray-500">Estado</th>
                <th className="px-6 py-4 font-normal text-gray-500 text-right">
                  Ajustar Stock
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                    Cargando inventario…
                  </td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                    {onlyLowStock
                      ? "No hay productos con stock bajo o agotado."
                      : "Aún no hay productos registrados."}
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((product) => {
                  const stock = Number(product.stock) || 0;
                  const low = stock > 0 && stock <= LOW_STOCK_THRESHOLD;
                  const isUpdating = updatingId === product.id;

                  return (
                    <tr
                      key={product.id}
                      className="group transition-colors hover:bg-gray-50/50"
                    >
                      <td className="px-6 py-4 font-medium">
                        <Link
                          href={`/admin/products/${product.id}`}
                          className="hover:underline"
                        >
                          {product.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {formatCOP(Math.round((Number(product.price) || 0) * 100))}
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {Number(product.weight_kg) || 0} kg
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={cn(
                            "font-medium",
                            low || stock === 0
                              ? "text-rose-500"
                              : "text-emerald-600",
                          )}
                        >
                          {stock}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge
                          status={
                            stock === 0
                              ? "out_of_stock"
                              : low
                                ? "low_stock"
                                : "active"
                          }
                        />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <input
                            type="number"
                            step="1"
                            value={deltaByProduct[product.id] ?? ""}
                            onChange={(e) =>
                              setDeltaByProduct((p) => ({
                                ...p,
                                [product.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void applyDelta(product);
                              }
                            }}
                            className="w-20 px-2 py-1 rounded-lg border border-gray-200 text-right text-sm outline-none focus:border-black"
                            placeholder="+ / -"
                          />
                          <Button
                            size="sm"
                            radius="full"
                            className="bg-black text-white"
                            isDisabled={isUpdating}
                            onPress={() => void applyDelta(product)}
                          >
                            {isUpdating ? "..." : "Actualizar"}
                          </Button>
                        </div>
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