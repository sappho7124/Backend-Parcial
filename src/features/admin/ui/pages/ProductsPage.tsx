"use client";

import { StatusBadge } from "../components/StatusBadge";
import { Search, Plus, Grid, List as ListIcon, Trash2 } from "lucide-react";
import { ProductTileCard } from "@/src/shared/presentation/ui/product/ProductTileCard";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn, Button } from "@heroui/react";

import { getSupabaseBrowserClient } from "@/src/lib/supabase/browser";
import { getAdminBootstrapSql, useAdminAccess } from "../client/useAdminAccess";
import { formatCOP } from "@/src/shared/presentation/ui";

const BOOT_KEY = "swiftdrop_admin_booted_v1";

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  weight_kg: number | string;
  stock: number;
};

export function ProductsPage() {
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
      } catch {
        // ignore storage error
      }
      setBooted(true);
    }
  }, [access.status, booted]);

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "in_stock" | "out_of_stock">("all");

  async function load() {
    setError("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from("products")
        .select("id, name, description, price, weight_kg, stock")
        .order("name", { ascending: true })
        .limit(500);

      if (fetchError) throw fetchError;
      setRows((data ?? []) as ProductRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando productos");
    } finally {
      setLoading(false);
    }
  }

  async function deleteProduct(product: ProductRow) {
    if (!window.confirm(`¿Eliminar producto "${product.name}"?`)) return;
    setError("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    const { error: deleteError } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id);

    if (deleteError) {
      setError(deleteError.message);
      setLoading(false);
      return;
    }
    await load();
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.status]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((p) => {
      const stockNum = Number(p.stock) || 0;
      if (stockFilter === "in_stock" && stockNum <= 0) return false;
      if (stockFilter === "out_of_stock" && stockNum > 0) return false;

      if (!q) return true;
      const desc = (p.description ?? "").toLowerCase();
      return p.name.toLowerCase().includes(q) || desc.includes(q);
    });
  }, [rows, query, stockFilter]);

  const normalized = useMemo(() => {
    return filtered.map((p) => {
      const stockNum = Number(p.stock) || 0;
      const weightNum = Number(p.weight_kg) || 0;
      const pricePesos = Number(p.price) || 0;
      const statusBadge =
        stockNum === 0 ? "out_of_stock" : stockNum <= 5 ? "low_stock" : "active";

      return {
        ...p,
        stockNum,
        weightNum,
        statusBadge,
        formattedPrice: formatCOP(Math.round(pricePesos * 100)),
        image: "/placeholder.svg",
      };
    });
  }, [filtered]);

  if (access.status === "missing-env") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Productos</h2>
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
        <h2 className="text-2xl font-normal">Productos</h2>
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
        <h2 className="text-2xl font-normal">Productos</h2>
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
          <h2 className="text-2xl font-normal">Productos</h2>
          <p className="text-sm text-gray-500 font-light mt-1">
            Gestiona tu catálogo de productos ({rows.length} registrados).
          </p>
        </div>
        <Button
          as={Link}
          href="/admin/products/new"
          size="lg"
          radius="full"
          className="bg-black text-white"
        >
          <Plus size={18} />
          <span>Agregar Producto</span>
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 shadow-sm">
        <div className="relative flex-1">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            size={18}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o descripción..."
            className="w-full h-10 pl-12 pr-4 bg-gray-50 outline-none focus:ring-1 focus:ring-gray-200 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={stockFilter}
            onChange={(e) =>
              setStockFilter(e.target.value as "all" | "in_stock" | "out_of_stock")
            }
            className="h-10 px-4 rounded-full bg-zinc-100 text-black text-sm outline-none cursor-pointer"
          >
            <option value="all">Todos</option>
            <option value="in_stock">Con stock</option>
            <option value="out_of_stock">Agotados</option>
          </select>

          <div className="flex bg-gray-50 p-1 border border-gray-100">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-2 rounded-xl transition-all",
                viewMode === "grid"
                  ? "bg-white shadow-sm"
                  : "text-gray-400 hover:text-black",
              )}
            >
              <Grid size={18} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "p-2 rounded-xl transition-all",
                viewMode === "list"
                  ? "bg-white shadow-sm"
                  : "text-gray-400 hover:text-black",
              )}
            >
              <ListIcon size={18} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {viewMode === "list" ? (
        <div className="bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/50">
                <tr>
                  <th className="px-6 py-4 font-normal text-gray-500">Producto</th>
                  <th className="px-6 py-4 font-normal text-gray-500">Peso</th>
                  <th className="px-6 py-4 font-normal text-gray-500">Stock</th>
                  <th className="px-6 py-4 font-normal text-gray-500">Precio</th>
                  <th className="px-6 py-4 font-normal text-gray-500">Estado</th>
                  <th className="px-6 py-4 font-normal text-gray-500 text-right">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading && (
                  <tr>
                    <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                      Cargando productos…
                    </td>
                  </tr>
                )}

                {!loading && normalized.length === 0 && (
                  <tr>
                    <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                      Aún no hay productos.
                    </td>
                  </tr>
                )}

                {!loading &&
                  normalized.map((product) => (
                    <tr
                      key={product.id}
                      className="group transition-colors hover:bg-gray-50/50"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                            <img
                              src={product.image}
                              alt={product.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <Link
                              href={`/admin/products/${product.id}`}
                              className="font-medium hover:underline block truncate"
                            >
                              {product.name}
                            </Link>
                            {product.description && (
                              <p className="text-xs text-gray-400 truncate max-w-xs">
                                {product.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {product.weightNum} kg
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {product.stockNum} unidades
                      </td>
                      <td className="px-6 py-4 font-medium">
                        {product.formattedPrice}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={product.statusBadge} />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            href={`/admin/products/${product.id}`}
                            className="text-gray-400 hover:text-black text-xs uppercase"
                          >
                            Editar
                          </Link>
                          <button
                            className="text-gray-400 hover:text-red-600 pl-2"
                            type="button"
                            onClick={() => void deleteProduct(product)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {loading && (
            <div className="bg-white p-6 shadow-sm text-sm text-gray-500">
              Cargando productos…
            </div>
          )}

          {!loading && normalized.length === 0 && (
            <div className="bg-white p-6 shadow-sm text-sm text-gray-500 col-span-full">
              Aún no hay productos.
            </div>
          )}

          {!loading &&
            normalized.map((product) => (
              <div key={product.id}>
                <ProductTileCard
                  href={`/admin/products/${product.id}`}
                  name={product.name}
                  imageUrl={product.image}
                  badge={product.statusBadge}
                  subcategory={`${product.weightNum} kg • ${product.stockNum} uds`}
                  price={product.formattedPrice}
                />

                <div className="mt-2 flex justify-between items-center px-1">
                  <button
                    className="text-gray-400 hover:text-red-600"
                    type="button"
                    onClick={() => void deleteProduct(product)}
                  >
                    <Trash2 size={16} />
                  </button>
                  <Link
                    href={`/admin/products/${product.id}`}
                    className="text-xs text-gray-500 hover:text-black uppercase"
                  >
                    Editar
                  </Link>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}