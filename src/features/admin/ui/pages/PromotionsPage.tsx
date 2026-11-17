"use client";

import { StatusBadge } from "../components/StatusBadge";
import { Plus, Tag, Clock, Calendar, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@heroui/react";

import { getSupabaseBrowserClient } from "@/src/lib/supabase/browser";
import { getAdminBootstrapSql, useAdminAccess } from "../client/useAdminAccess";
import { formatCOP } from "@/src/shared/presentation/ui";

const BOOT_KEY = "swiftdrop_admin_booted_v1";

type PromotionType = "percent" | "fixed" | "free_shipping";

type PromotionRow = {
  id: string;
  name: string;
  code: string | null;
  type: PromotionType;
  value_percent: number | null;
  value_cents: number | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
};

function formatDateRange(startsAt: string | null, endsAt: string | null) {
  if (!startsAt && !endsAt) return "En curso";
  const fmt = new Intl.DateTimeFormat("es-CO", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  if (startsAt && endsAt) {
    return `${fmt.format(new Date(startsAt))} - ${fmt.format(new Date(endsAt))}`;
  }
  if (startsAt) return `Desde ${fmt.format(new Date(startsAt))}`;
  return `Hasta ${fmt.format(new Date(endsAt!))}`;
}

function toCardStatus(p: PromotionRow) {
  const now = new Date();
  if (!p.active) return "cancelled";
  if (p.starts_at && new Date(p.starts_at) > now) return "processing";
  if (p.ends_at && new Date(p.ends_at) < now) return "cancelled";
  return "active";
}

function formatValue(p: PromotionRow) {
  if (p.type === "percent") return `${p.value_percent ?? 0}% OFF`;
  if (p.type === "fixed") return `${formatCOP(p.value_cents ?? 0)} OFF`;
  return "Envío Gratis";
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

const EMPTY_FORM = {
  name: "",
  code: "",
  type: "percent" as PromotionType,
  value_percent: "10",
  value_pesos: "15000",
  starts_at: "",
  ends_at: "",
  active: true,
};

export function PromotionsPage() {
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

  const [rows, setRows] = useState<PromotionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PromotionRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  async function load() {
    setError("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from("promotions")
        .select(
          "id, name, code, type, value_percent, value_cents, starts_at, ends_at, active",
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (fetchErr) throw fetchErr;
      setRows((data ?? []) as PromotionRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando promociones");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.status]);

  function openCreateModal() {
    setError("");
    setSuccess("");
    setEditingPromo(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEditModal(promo: PromotionRow) {
    setError("");
    setSuccess("");
    setEditingPromo(promo);
    setForm({
      name: promo.name,
      code: promo.code ?? "",
      type: promo.type,
      value_percent:
        promo.value_percent !== null && promo.value_percent !== undefined
          ? String(promo.value_percent)
          : "10",
      value_pesos:
        promo.value_cents !== null && promo.value_cents !== undefined
          ? String(Math.round(promo.value_cents / 100))
          : "15000",
      starts_at: toDateInputValue(promo.starts_at),
      ends_at: toDateInputValue(promo.ends_at),
      active: promo.active,
    });
    setModalOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const name = form.name.trim();
    if (!name) {
      setError("El nombre de la promoción es obligatorio.");
      return;
    }

    let valuePercent: number | null = null;
    let valueCents: number | null = null;

    if (form.type === "percent") {
      const pct = Number(form.value_percent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        setError("El porcentaje de descuento debe estar entre 1 y 100.");
        return;
      }
      valuePercent = Math.round(pct);
    } else if (form.type === "fixed") {
      const pesos = Number(form.value_pesos);
      if (!Number.isFinite(pesos) || pesos <= 0) {
        setError("El monto de descuento en COP debe ser mayor a 0.");
        return;
      }
      valueCents = Math.round(pesos * 100);
    }

    const startsAt = form.starts_at
      ? new Date(`${form.starts_at}T00:00:00`).toISOString()
      : null;
    const endsAt = form.ends_at
      ? new Date(`${form.ends_at}T23:59:59`).toISOString()
      : null;

    if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
      setError("La fecha de inicio no puede ser posterior a la fecha de fin.");
      return;
    }

    const payload = {
      name,
      code: form.code.trim().toUpperCase() || null,
      type: form.type,
      value_percent: valuePercent,
      value_cents: valueCents,
      starts_at: startsAt,
      ends_at: endsAt,
      active: form.active,
    };

    setSaving(true);
    try {
      if (!editingPromo) {
        const { error: insErr } = await supabase
          .from("promotions")
          .insert(payload)
          .select("id")
          .single();

        if (insErr) throw insErr;
        setSuccess("Promoción creada correctamente.");
      } else {
        const { data: updated, error: updErr } = await supabase
          .from("promotions")
          .update(payload)
          .eq("id", editingPromo.id)
          .select("id")
          .maybeSingle();

        if (updErr) throw updErr;
        if (!updated) {
          throw new Error(
            "No se actualizó la promoción. Verifica las políticas RLS de UPDATE en public.promotions.",
          );
        }
        setSuccess("Promoción actualizada correctamente.");
      }

      setModalOpen(false);
      setEditingPromo(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando promoción");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(promo: PromotionRow) {
    if (
      !window.confirm(
        `¿Eliminar la promoción "${promo.name}"? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }

    setError("");
    setSuccess("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setSaving(true);
    try {
      const { data: deleted, error: delErr } = await supabase
        .from("promotions")
        .delete()
        .eq("id", promo.id)
        .select("id")
        .maybeSingle();

      if (delErr) throw delErr;
      if (!deleted) {
        throw new Error(
          "No se eliminó la promoción. Verifica las políticas RLS de DELETE en public.promotions.",
        );
      }

      setModalOpen(false);
      setEditingPromo(null);
      setSuccess("Promoción eliminada.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error eliminando promoción");
    } finally {
      setSaving(false);
    }
  }

  const cards = useMemo(
    () =>
      rows.map((p) => ({
        raw: p,
        ...p,
        status: toCardStatus(p),
        value: formatValue(p),
        dates: formatDateRange(p.starts_at, p.ends_at),
      })),
    [rows],
  );

  if (access.status === "missing-env") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Promociones</h2>
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
        <h2 className="text-2xl font-normal">Promociones</h2>
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
        <h2 className="text-2xl font-normal">Promociones</h2>
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
          <h2 className="text-2xl font-normal">Promociones</h2>
          <p className="text-sm text-gray-500 font-light mt-1">
            Gestiona campañas de marketing y cupones de descuento.
          </p>
        </div>
        <Button
          size="lg"
          radius="full"
          className="bg-black text-white"
          onPress={openCreateModal}
        >
          <Plus size={18} />
          <span>Crear Promoción</span>
        </Button>
      </div>

      {error && !modalOpen && (
        <div className="border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {loading && (
          <div className="bg-white p-6 shadow-sm text-sm text-gray-500">
            Cargando promociones…
          </div>
        )}

        {!loading &&
          cards.map((promo) => (
            <div
              key={promo.id}
              className="relative group bg-white p-6 shadow-sm transition-all hover:shadow-md flex flex-col justify-between"
            >
              <div>
                <div className="absolute top-6 right-6">
                  <StatusBadge status={promo.status} />
                </div>

                <div className="flex items-center gap-3 mb-6 pr-24">
                  <div className="h-12 w-12 bg-gray-50 flex items-center justify-center shrink-0">
                    {promo.type === "free_shipping" ? (
                      <Clock size={20} className="text-purple-600" />
                    ) : (
                      <Tag size={20} className="text-emerald-600" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-medium">{promo.name}</h3>
                    <p className="text-xs text-gray-500">
                      {promo.type === "percent"
                        ? "Porcentaje"
                        : promo.type === "fixed"
                          ? "Monto Fijo"
                          : "Envío Gratis"}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm p-3 bg-gray-50/50">
                    <span className="text-gray-500">Valor</span>
                    <span className="font-medium">{promo.value}</span>
                  </div>
                  {promo.code && (
                    <div className="flex justify-between items-center text-sm p-3 bg-gray-50/50">
                      <span className="text-gray-500">Código</span>
                      <span className="font-mono font-medium">
                        {promo.code}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-sm p-3 bg-gray-50/50">
                    <span className="text-gray-500 flex items-center gap-2">
                      <Calendar size={14} /> Duración
                    </span>
                    <span className="font-medium text-right">{promo.dates}</span>
                  </div>
                </div>
              </div>

              <Button
                size="lg"
                radius="full"
                className="bg-zinc-100 text-black w-full mt-6 hover:bg-zinc-200"
                onPress={() => openEditModal(promo.raw)}
              >
                Gestionar Detalles
              </Button>
            </div>
          ))}

        {/* Add New Placeholder Card */}
        <button
          type="button"
          onClick={openCreateModal}
          className="flex flex-col items-center justify-center gap-4 border-2 border-dashed border-gray-200 p-6 min-h-[280px] text-gray-400 transition-all hover:border-black hover:text-black hover:bg-gray-50 cursor-pointer"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-50">
            <Plus size={24} />
          </div>
          <span className="font-medium">Crear Nueva Campaña</span>
        </button>
      </div>

      {/* Modal Crear / Editar Promoción */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg bg-white p-6 sm:p-8 shadow-xl space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <h3 className="text-xl font-normal">
                {editingPromo ? "Gestionar Promoción" : "Nueva Promoción"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-2 text-gray-400 hover:text-black rounded-full hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-gray-500">
                  Nombre de la campaña *
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder="Ej. Bienvenida Primer Pedido"
                  className="w-full h-11 px-4 bg-gray-50 border border-gray-200 text-sm outline-none focus:border-black"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-gray-500">
                    Código promocional
                  </label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        code: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="Ej. CAFE15"
                    className="w-full h-11 px-4 bg-gray-50 border border-gray-200 text-sm font-mono uppercase outline-none focus:border-black"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-gray-500">
                    Tipo de beneficio
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        type: e.target.value as PromotionType,
                      }))
                    }
                    className="w-full h-11 px-3 bg-gray-50 border border-gray-200 text-sm outline-none focus:border-black"
                  >
                    <option value="percent">Porcentaje (%)</option>
                    <option value="fixed">Monto Fijo (COP)</option>
                    <option value="free_shipping">Envío Gratis</option>
                  </select>
                </div>
              </div>

              {form.type === "percent" && (
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-gray-500">
                    Porcentaje de descuento (%) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    required
                    value={form.value_percent}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, value_percent: e.target.value }))
                    }
                    className="w-full h-11 px-4 bg-gray-50 border border-gray-200 text-sm outline-none focus:border-black"
                  />
                </div>
              )}

              {form.type === "fixed" && (
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-gray-500">
                    Descuento fijo (COP) *
                  </label>
                  <input
                    type="number"
                    min="100"
                    step="100"
                    required
                    value={form.value_pesos}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, value_pesos: e.target.value }))
                    }
                    className="w-full h-11 px-4 bg-gray-50 border border-gray-200 text-sm outline-none focus:border-black"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-gray-500">
                    Fecha inicio (opcional)
                  </label>
                  <input
                    type="date"
                    value={form.starts_at}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, starts_at: e.target.value }))
                    }
                    className="w-full h-11 px-4 bg-gray-50 border border-gray-200 text-sm outline-none focus:border-black"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-gray-500">
                    Fecha fin (opcional)
                  </label>
                  <input
                    type="date"
                    value={form.ends_at}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, ends_at: e.target.value }))
                    }
                    className="w-full h-11 px-4 bg-gray-50 border border-gray-200 text-sm outline-none focus:border-black"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 pt-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, active: e.target.checked }))
                  }
                  className="h-4 w-4 accent-black"
                />
                <span>Promoción activa</span>
              </label>

              <div className="flex items-center justify-between gap-3 pt-4 border-t border-gray-100">
                {editingPromo ? (
                  <Button
                    type="button"
                    radius="full"
                    variant="flat"
                    className="bg-red-50 text-red-600 hover:bg-red-100"
                    isDisabled={saving}
                    onPress={() => void handleDelete(editingPromo)}
                  >
                    <Trash2 size={15} />
                    <span>Eliminar</span>
                  </Button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    radius="full"
                    variant="flat"
                    className="bg-zinc-100 text-gray-700"
                    isDisabled={saving}
                    onPress={() => setModalOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    radius="full"
                    className="bg-black text-white px-6"
                    isDisabled={saving}
                  >
                    {saving
                      ? "Guardando…"
                      : editingPromo
                        ? "Guardar Cambios"
                        : "Crear Promoción"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}