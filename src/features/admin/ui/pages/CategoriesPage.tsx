"use client";

import {
  Folder,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@heroui/react";

import { getSupabaseBrowserClient } from "@/src/lib/supabase/browser";
import { getAdminBootstrapSql, useAdminAccess } from "../client/useAdminAccess";
import { slugify } from "../client/slugify";

type CategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  cover_image_url?: string | null;
  is_active: boolean;
  sort_order: number;
};

type CategoryNode = CategoryRow & { children: CategoryNode[] };

export function CategoriesPage() {
  const access = useAdminAccess();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [slugTouched, setSlugTouched] = useState(false);

  const [form, setForm] = useState({
    name: "",
    slug: "",
    parent_id: "",
    cover_image_url: "",
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    slug: "",
    is_active: true,
  });

  function handleNameChange(value: string) {
    setForm((prev) => ({
      ...prev,
      name: value,
      slug: slugTouched ? prev.slug : slugify(value),
    }));
  }

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setForm((prev) => ({
      ...prev,
      slug: slugify(value),
    }));
  }

  const tree = useMemo(() => {
    const byId = new Map<string, CategoryNode>();
    for (const row of rows) {
      byId.set(row.id, { ...row, children: [] });
    }
    const roots: CategoryNode[] = [];
    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) {
        byId.get(node.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortFn = (a: CategoryNode, b: CategoryNode) =>
      a.sort_order !== b.sort_order
        ? a.sort_order - b.sort_order
        : a.name.localeCompare(b.name);

    const sortRec = (nodes: CategoryNode[]) => {
      nodes.sort(sortFn);
      for (const n of nodes) sortRec(n.children);
    };
    sortRec(roots);

    return roots;
  }, [rows]);

  async function load() {
    setError("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from("categories")
        .select("id, parent_id, name, slug, cover_image_url, is_active, sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (fetchErr) throw fetchErr;

      const list = (data ?? []) as CategoryRow[];
      setRows(list);

      // Expandir automáticamente las categorías padre la primera vez
      setExpanded((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const initial: Record<string, boolean> = {};
        for (const item of list) {
          if (item.parent_id) initial[item.parent_id] = true;
        }
        return initial;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando categorías");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.status]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  async function createCategory(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const name = form.name.trim();
    const slug = (form.slug || slugify(name)).trim();
    if (!name || !slug) {
      setError("El nombre y el slug son obligatorios.");
      return;
    }

    setSaving(true);
    try {
      const parentId = form.parent_id || null;
      const { error: insErr } = await supabase
        .from("categories")
        .insert({
          name,
          slug,
          parent_id: parentId,
          cover_image_url: form.cover_image_url.trim() || null,
          is_active: true,
        })
        .select("id")
        .single();

      if (insErr) throw insErr;

      if (parentId) {
        setExpanded((prev) => ({ ...prev, [parentId]: true }));
      }
      setForm({ name: "", slug: "", parent_id: "", cover_image_url: "" });
      setSlugTouched(false);
      setSuccess("Categoría creada correctamente.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando categoría");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(cat: CategoryRow) {
    setEditingId(cat.id);
    setEditForm({
      name: cat.name,
      slug: cat.slug,
      is_active: cat.is_active,
    });
  }

  async function saveEdit(id: string) {
    setError("");
    setSuccess("");
    if (access.status !== "ready") return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const name = editForm.name.trim();
    const slug = slugify(editForm.slug || name);
    if (!name || !slug) {
      setError("El nombre y el slug no pueden estar vacíos.");
      return;
    }

    setSaving(true);
    try {
      const { data: updated, error: updErr } = await supabase
        .from("categories")
        .update({
          name,
          slug,
          is_active: editForm.is_active,
        })
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (updErr) throw updErr;
      if (!updated) {
        throw new Error(
          "No se actualizó la categoría. Verifica las políticas RLS de UPDATE en public.categories.",
        );
      }

      setEditingId(null);
      setSuccess("Categoría actualizada.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error actualizando categoría");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(cat: CategoryRow) {
    if (
      !window.confirm(
        `¿Eliminar la categoría "${cat.name}"? Las subcategorías pasarán a nivel superior.`,
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
        .from("categories")
        .delete()
        .eq("id", cat.id)
        .select("id")
        .maybeSingle();

      if (delErr) throw delErr;
      if (!deleted) {
        throw new Error(
          "No se eliminó la categoría. Verifica las políticas RLS de DELETE en public.categories.",
        );
      }

      if (editingId === cat.id) setEditingId(null);
      setSuccess("Categoría eliminada.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error eliminando categoría");
    } finally {
      setSaving(false);
    }
  }

  if (access.status === "missing-env") {
    return (
      <div className="bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-normal">Categorías</h2>
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
        <h2 className="text-2xl font-normal">Categorías</h2>
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
        <h2 className="text-2xl font-normal">Categorías</h2>
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Category Tree */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-normal">Categorías</h2>
              <p className="text-sm text-gray-500 font-light mt-1">
                Estructura tu catálogo de productos ({rows.length} categorías).
              </p>
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

          <div className="bg-white p-3 shadow-sm">
            {loading && (
              <div className="p-4 text-sm text-gray-500">
                Cargando categorías…
              </div>
            )}
            {!loading && tree.length === 0 && (
              <div className="p-4 text-sm text-gray-500">
                Aún no hay categorías. Crea la primera desde el formulario.
              </div>
            )}

            {!loading &&
              tree.map((cat) => (
                <div
                  key={cat.id}
                  className="mb-2 last:mb-0 border-b border-gray-50 last:border-b-0 pb-2 last:pb-0"
                >
                  {editingId === cat.id ? (
                    <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50">
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) =>
                          setEditForm((p) => ({ ...p, name: e.target.value }))
                        }
                        className="h-9 px-3 bg-white border border-gray-200 text-sm outline-none focus:border-black"
                      />
                      <input
                        type="text"
                        value={editForm.slug}
                        onChange={(e) =>
                          setEditForm((p) => ({ ...p, slug: e.target.value }))
                        }
                        className="h-9 px-3 bg-white border border-gray-200 text-sm outline-none focus:border-black"
                      />
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 px-2">
                        <input
                          type="checkbox"
                          checked={editForm.is_active}
                          onChange={(e) =>
                            setEditForm((p) => ({
                              ...p,
                              is_active: e.target.checked,
                            }))
                          }
                        />
                        Activa
                      </label>
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void saveEdit(cat.id)}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-full"
                          title="Guardar"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="p-1.5 text-gray-500 hover:bg-gray-200 rounded-full"
                          title="Cancelar"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="group flex items-center justify-between p-3 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleExpand(cat.id)}
                          className="p-1 rounded-full hover:bg-gray-200 text-gray-500"
                        >
                          {cat.children.length > 0 ? (
                            expanded[cat.id] ? (
                              <ChevronDown size={16} />
                            ) : (
                              <ChevronRight size={16} />
                            )
                          ) : (
                            <Folder size={15} className="text-gray-400" />
                          )}
                        </button>
                        <span className="font-medium">{cat.name}</span>
                        <span className="text-xs text-gray-400">
                          ({cat.slug})
                        </span>
                        {!cat.is_active && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                            Inactiva
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          className="text-xs font-medium text-gray-600 hover:text-black hover:underline px-2"
                          onClick={() =>
                            setForm((p) => ({ ...p, parent_id: cat.id }))
                          }
                        >
                          + Subcategoría
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(cat)}
                          className="p-1.5 text-gray-400 hover:text-black rounded-full hover:bg-gray-100"
                          title="Editar"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(cat)}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-50"
                          title="Eliminar"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  )}

                  {expanded[cat.id] && cat.children.length > 0 && (
                    <div className="ml-8 mt-1 space-y-1 border-l border-gray-100 pl-4 py-1">
                      {cat.children.map((sub) =>
                        editingId === sub.id ? (
                          <div
                            key={sub.id}
                            className="flex flex-wrap items-center gap-2 p-2 bg-gray-50"
                          >
                            <input
                              type="text"
                              value={editForm.name}
                              onChange={(e) =>
                                setEditForm((p) => ({
                                  ...p,
                                  name: e.target.value,
                                }))
                              }
                              className="h-8 px-2.5 bg-white border border-gray-200 text-xs outline-none focus:border-black"
                            />
                            <input
                              type="text"
                              value={editForm.slug}
                              onChange={(e) =>
                                setEditForm((p) => ({
                                  ...p,
                                  slug: e.target.value,
                                }))
                              }
                              className="h-8 px-2.5 bg-white border border-gray-200 text-xs outline-none focus:border-black"
                            />
                            <label className="flex items-center gap-1 text-xs text-gray-600 px-1">
                              <input
                                type="checkbox"
                                checked={editForm.is_active}
                                onChange={(e) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    is_active: e.target.checked,
                                  }))
                                }
                              />
                              Activa
                            </label>
                            <div className="ml-auto flex items-center gap-1">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => void saveEdit(sub.id)}
                                className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-full"
                                title="Guardar"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="p-1 text-gray-500 hover:bg-gray-200 rounded-full"
                                title="Cancelar"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            key={sub.id}
                            className="group flex items-center justify-between p-2 hover:bg-gray-50 transition-colors"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="text-sm">{sub.name}</span>
                              <span className="text-xs text-gray-400">
                                ({sub.slug})
                              </span>
                              {!sub.is_active && (
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                                  Inactiva
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => startEdit(sub)}
                                className="p-1 text-gray-400 hover:text-black rounded-full hover:bg-gray-100"
                                title="Editar"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDelete(sub)}
                                className="p-1 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-50"
                                title="Eliminar"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>

        {/* Create Form */}
        <div className="space-y-6">
          <form
            onSubmit={(e) => void createCategory(e)}
            className="bg-white p-6 shadow-sm sticky top-24 space-y-4"
          >
            <h3 className="text-lg font-normal mb-2">Crear Categoría</h3>

            <div className="space-y-2">
              <label className="text-sm font-medium ml-1">Nombre *</label>
              <input
                type="text"
                required
                placeholder="Ej. Café Molido"
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full h-12 px-4 bg-gray-50 border border-transparent focus:bg-white focus:border-black outline-none transition-all text-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium ml-1">Slug *</label>
              <input
                type="text"
                required
                placeholder="cafe-molido"
                value={form.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                className="w-full h-12 px-4 bg-gray-50 border border-transparent focus:bg-white focus:border-black outline-none transition-all text-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium ml-1">
                Categoría Padre
              </label>
              <select
                value={form.parent_id}
                onChange={(e) =>
                  setForm((p) => ({ ...p, parent_id: e.target.value }))
                }
                className="w-full h-12 px-4 bg-gray-50 border border-transparent focus:bg-white focus:border-black outline-none transition-all cursor-pointer text-sm"
              >
                <option value="">Ninguna (Nivel Superior)</option>
                {rows
                  .filter((c) => !c.parent_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium ml-1">
                Imagen de Portada
              </label>
              <input
                type="url"
                placeholder="https://..."
                value={form.cover_image_url}
                onChange={(e) =>
                  setForm((p) => ({ ...p, cover_image_url: e.target.value }))
                }
                className="w-full h-12 px-4 bg-gray-50 border border-transparent focus:bg-white focus:border-black outline-none transition-all text-sm"
              />
            </div>

            <Button
              type="submit"
              size="lg"
              radius="full"
              className="bg-black text-white w-full"
              isDisabled={saving}
            >
              {saving ? "Guardando…" : "Crear Categoría"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}