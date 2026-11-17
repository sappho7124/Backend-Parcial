"use client";

import { ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@heroui/react";

import { getSupabaseBrowserClient } from "@/src/lib/supabase/browser";
import { formatCOP } from "@/src/shared/presentation/ui";
import { getAdminBootstrapSql, useAdminAccess } from "../client/useAdminAccess";

type DbProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  weight_kg: number | string;
  stock: number;
};

export function ProductEditorPage(_props: {
  params?: Promise<{ id: string }> | { id: string };
}) {
  const access = useAdminAccess();
  const router = useRouter();
  const routeParams = useParams<{ id?: string }>();
  const productId = typeof routeParams?.id === "string" ? routeParams.id : null;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    weight_kg: "0",
    stock: "0",
  });

  async function loadProduct() {
    setError("");
    setSuccess("");
    if (!productId) return;
    if (access.status !== "ready") return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    try {
      const { data, error: prodErr } = await supabase
        .from("products")
        .select("id, name, description, price, weight_kg, stock")
        .eq("id", productId)
        .single();

      if (prodErr) throw prodErr;

      const p = data as DbProductRow;
      setForm({
        name: p.name ?? "",
        description: p.description ?? "",
        price: p.price !== null && p.price !== undefined ? String(p.price) : "",
        weight_kg: p.weight_kg !== null && p.weight_kg !== undefined ? String(p.weight_kg) : "0",
        stock: p.stock !== null && p.stock !== undefined ? String(p.stock) : "0",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando producto");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, access.status]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const name = form.name.trim();
    if (!name) {
      setError("El nombre del producto es obligatorio.");
      return;
    }

    const price = Number(form.price);
    if (!form.price.trim() || !Number.isFinite(price) || price < 0) {
      setError("Ingresa un precio válido (mayor o igual a 0).");
      return;
    }

    const weightKg = form.weight_kg.trim() ? Number(form.weight_kg) : 0;
    if (!Number.isFinite(weightKg) || weightKg < 0) {
      setError("El peso (kg) debe ser un número mayor o igual a 0.");
      return;
    }

    const stock = form.stock.trim() ? Number(form.stock) : 0;
    if (!Number.isFinite(stock) || !Number.isInteger(stock) || stock < 0) {
      setError("El stock debe ser un número entero mayor o igual a 0.");
      return;
    }

    const payload = {
      name,
      description: form.description.trim() || null,
      price,
      weight_kg: weightKg,
      stock,
    };

    setSaving(true);
    try {
      if (!productId) {
        const { error: insErr } = await supabase
          .from("products")
          .insert(payload)
          .select("id")
          .single();

        if (insErr) throw insErr;

        router.push("/admin/products");
        router.refresh();
        return;
      }

      const { data: updated, error: updErr } = await supabase
        .from("products")
        .update(payload)
        .eq("id", productId)
        .select("id")
        .maybeSingle();

      if (updErr) throw updErr;
      if (!updated) {
        throw new Error(
          "No se actualizó ningún registro. Verifica las políticas RLS de UPDATE en public.products.",
        );
      }

      setSuccess("Producto actualizado correctamente.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando producto");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!productId) return;
    if (!window.confirm(`¿Eliminar el producto "${form.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    setError("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setSaving(true);
    try {
      const { data: deleted, error: delErr } = await supabase
        .from("products")
        .delete()
        .eq("id", productId)
        .select("id")
        .maybeSingle();

      if (delErr) throw delErr;
      if (!deleted) {
        throw new Error(
          "No se eliminó ningún registro. Verifica las políticas RLS de DELETE en public.products.",
        );
      }

      router.push("/admin/products");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error eliminando producto");
      setSaving(false);
    }
  }

  if (access.status === "missing-env") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Producto</h2>
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
        <h2 className="text-2xl font-normal">Producto</h2>
        <p className="mt-2 text-sm text-gray-600">
          Inicia sesión para acceder al panel de admin.
        </p>
      </div>
    );
  }

  if (access.status === "forbidden") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Producto</h2>
        <p className="mt-2 text-sm text-gray-600">
          Tu usuario no tiene permisos de admin.
        </p>
        <pre className="mt-4 bg-gray-50 p-4 text-xs overflow-auto">
          {getAdminBootstrapSql(access.userId)}
        </pre>
      </div>
    );
  }

  const pricePreview = formatCOP(Math.round((Number(form.price) || 0) * 100));

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/products"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm hover:text-black transition-colors"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h2 className="text-2xl font-normal">
              {productId ? "Editar Producto" : "Nuevo Producto"}
            </h2>
            <p className="text-sm text-gray-500 font-light mt-0.5">
              {productId
                ? "Modifica los datos, precio o inventario del producto."
                : "Completa la información para agregar un producto al catálogo."}
            </p>
          </div>
        </div>

        {productId && (
          <Button
            type="button"
            variant="flat"
            radius="full"
            className="bg-red-50 text-red-600 hover:bg-red-100"
            disabled={saving || loading}
            onPress={() => void handleDelete()}
          >
            <Trash2 size={16} />
            <span>Eliminar</span>
          </Button>
        )}
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <form onSubmit={(e) => void handleSave(e)} className="bg-white p-8 shadow-sm space-y-6">
        {loading ? (
          <p className="text-sm text-gray-500">Cargando información del producto…</p>
        ) : (
          <>
            <div className="space-y-2">
              <label className="block text-xs uppercase tracking-wider text-gray-500">
                Nombre del producto *
              </label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Ej. Café Especial Origen Huila 500g"
                className="w-full h-11 px-4 bg-gray-50 border border-gray-200 text-sm outline-none focus:border-black transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs uppercase tracking-wider text-gray-500">
                Descripción
              </label>
              <textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Detalles, características o notas del producto..."
                className="w-full p-4 bg-gray-50 border border-gray-200 text-sm outline-none focus:border-black transition-colors resize-y"
              />
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div className="space-y-2">
                <label className="block text-xs uppercase tracking-wider text-gray-500">
                  Precio (COP) *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={form.price}
                  onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                  placeholder="45000"
                  className="w-full h-11 px-4 bg-gray-50 border border-gray-200 text-sm outline-none focus:border-black transition-colors"
                />
                <p className="text-xs text-gray-400">Vista previa: {pricePreview}</p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs uppercase tracking-wider text-gray-500">
                  Peso (kg)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.weight_kg}
                  onChange={(e) => setForm((prev) => ({ ...prev, weight_kg: e.target.value }))}
                  placeholder="0.5"
                  className="w-full h-11 px-4 bg-gray-50 border border-gray-200 text-sm outline-none focus:border-black transition-colors"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs uppercase tracking-wider text-gray-500">
                  Stock disponible
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={form.stock}
                  onChange={(e) => setForm((prev) => ({ ...prev, stock: e.target.value }))}
                  placeholder="25"
                  className="w-full h-11 px-4 bg-gray-50 border border-gray-200 text-sm outline-none focus:border-black transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
              <Button
                as={Link}
                href="/admin/products"
                radius="full"
                variant="flat"
                className="bg-zinc-100 text-gray-700"
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                radius="full"
                className="bg-black text-white px-8"
                disabled={saving}
              >
                {saving
                  ? "Guardando…"
                  : productId
                    ? "Guardar Cambios"
                    : "Crear Producto"}
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}