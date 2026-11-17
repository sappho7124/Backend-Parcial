"use client";

import {
  Edit3,
  ExternalLink,
  LogOut,
  MapPin,
  Package,
  Plus,
  Trash2,
  Settings,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar, Modal, ModalBody, ModalContent, ModalHeader } from "@heroui/react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";

import { AuthModal } from "@/src/features/auth";
import {
  getSupabaseBrowserClient,
  getSupabaseMissingEnvMessage,
} from "@/src/lib/supabase/browser";

type TabId = "pedidos" | "direcciones" | "detalles" | "puntos";

type DbUserRow = {
  id: string;
  email: string;
  role: "MINORISTA" | "MAYORISTA" | "ADMIN";
  points: number;
  created_at: string;
};

type DbProfileRow = {
  user_id: string;
  full_name: string;
  phone_number: string | null;
  address: string | null;
  document_type: "CC" | "NIT" | "CE" | null;
  document_number: string | null;
};

type OrderRow = {
  id: string;
  created_at: string;
  status: string;
  total_amount: number | string;
  delivery_vehicle: string | null;
  delivery_pin: string | null;
  order_items?: Array<{
    quantity: number;
    products?: { name: string } | Array<{ name: string }> | null;
  }>;
};

type LoyaltyPointRow = {
  id: string;
  type: "EARNED" | "REDEEMED" | "EXPIRED";
  points_delta: number;
  description: string | null;
  created_at: string;
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
    month: "short",
    year: "numeric",
  });
}

function toHumanOrderStatus(status: string): "Entregado" | "Cancelado" | "Procesando" {
  switch ((status || "").toUpperCase()) {
    case "DELIVERED":
      return "Entregado";
    case "CANCELLED":
    case "REFUNDED":
      return "Cancelado";
    default:
      return "Procesando";
  }
}

function getOrderSummaryLabel(order: OrderRow): string {
  const items = order.order_items ?? [];
  if (items.length === 0) return formatDate(order.created_at);

  const firstProduct = items[0]?.products;
  const firstName = Array.isArray(firstProduct)
    ? firstProduct[0]?.name
    : firstProduct?.name;

  if (!firstName) return formatDate(order.created_at);
  if (items.length === 1) return firstName;
  return `${firstName} +${items.length - 1} más`;
}

export function ProfilePage() {
  const [activeTab, setActiveTab] = useState<TabId>("pedidos");

  const [session, setSession] = useState<Session | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [supabaseReady, setSupabaseReady] = useState(true);

  const [dbUser, setDbUser] = useState<DbUserRow | null>(null);
  const [profile, setProfile] = useState<DbProfileRow | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string>("");

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [addressInput, setAddressInput] = useState("");
  const [addressSaving, setAddressSaving] = useState(false);

  const [profileForm, setProfileForm] = useState({
    fullName: "",
    phone: "",
    documentType: "" as "" | "CC" | "NIT" | "CE",
    documentNumber: "",
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSavedMsg, setProfileSavedMsg] = useState("");

  const [loyaltyTransactions, setLoyaltyTransactions] = useState<LoyaltyPointRow[]>([]);

  const userData = useMemo(() => {
    const user = session?.user;
    const email = dbUser?.email || user?.email || "";
    const metaName =
      typeof user?.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : "";

    const name = profile?.full_name || metaName || (email ? email.split("@")[0] : "Invitado");
    const avatar_url =
      typeof user?.user_metadata?.avatar_url === "string"
        ? user.user_metadata.avatar_url
        : undefined;

    return {
      name,
      email,
      avatar_url,
    };
  }, [session, dbUser, profile]);

  useEffect(() => {
    const metaName =
      typeof session?.user.user_metadata?.full_name === "string"
        ? session.user.user_metadata.full_name
        : "";

    setProfileForm({
      fullName: profile?.full_name ?? metaName ?? "",
      phone: profile?.phone_number ?? "",
      documentType: profile?.document_type ?? "",
      documentNumber: profile?.document_number ?? "",
    });
  }, [profile, session]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setSupabaseReady(false);
      return;
    }

    setSupabaseReady(true);

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    async function loadAccountData() {
      setAccountError("");
      if (!session) {
        setDbUser(null);
        setProfile(null);
        setOrders([]);
        setLoyaltyTransactions([]);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;

      setAccountLoading(true);
      try {
        const authUserId = session.user.id;
        const authEmail = (session.user.email ?? "").trim().toLowerCase();

        // 1) Buscar usuario en public.users por ID o por email
        let { data: userRow, error: userErr } = await supabase
          .from("users")
          .select("id, email, role, points, created_at")
          .eq("id", authUserId)
          .maybeSingle();

        if (userErr) throw userErr;

        if (!userRow && authEmail) {
          const byEmail = await supabase
            .from("users")
            .select("id, email, role, points, created_at")
            .eq("email", authEmail)
            .maybeSingle();

          if (byEmail.error) throw byEmail.error;
          userRow = byEmail.data;
        }

        // Si no existe aún en public.users, crearlo
        if (!userRow && authEmail) {
          const { data: insertedUser, error: insertUserErr } = await supabase
            .from("users")
            .insert({
              id: authUserId,
              email: authEmail,
              password_hash: "supabase_auth_managed",
              role: "MINORISTA",
              points: 0,
            })
            .select("id, email, role, points, created_at")
            .single();

          if (insertUserErr) throw insertUserErr;
          userRow = insertedUser;
        }

        const resolvedUser = userRow as DbUserRow | null;
        setDbUser(resolvedUser);

        if (!resolvedUser) return;

        // 2) Cargar o crear perfil en public.profiles
        const { data: profileRow, error: profileErr } = await supabase
          .from("profiles")
          .select("user_id, full_name, phone_number, address, document_type, document_number")
          .eq("user_id", resolvedUser.id)
          .maybeSingle();

        if (profileErr) throw profileErr;

        if (profileRow) {
          setProfile(profileRow as DbProfileRow);
        } else {
          const defaultName =
            typeof session.user.user_metadata?.full_name === "string" &&
            session.user.user_metadata.full_name.trim()
              ? session.user.user_metadata.full_name.trim()
              : authEmail.split("@")[0] || "Cliente SwiftDrop";

          const { data: createdProfile, error: createProfErr } = await supabase
            .from("profiles")
            .insert({
              user_id: resolvedUser.id,
              full_name: defaultName,
            })
            .select("user_id, full_name, phone_number, address, document_type, document_number")
            .single();

          if (!createProfErr && createdProfile) {
            setProfile(createdProfile as DbProfileRow);
          }
        }

        // 3) Cargar pedidos en public.orders
        setOrdersLoading(true);
        const { data: ordersData, error: ordersErr } = await supabase
          .from("orders")
          .select(
            "id, created_at, status, total_amount, delivery_vehicle, delivery_pin, order_items(quantity, products(name))",
          )
          .eq("user_id", resolvedUser.id)
          .order("created_at", { ascending: false })
          .limit(50);

        if (ordersErr) throw ordersErr;
        setOrders((ordersData ?? []) as unknown as OrderRow[]);
        setOrdersLoading(false);

        // 4) Cargar historial en public.loyalty_points
        const { data: pointsData, error: pointsErr } = await supabase
          .from("loyalty_points")
          .select("id, type, points_delta, description, created_at")
          .eq("user_id", resolvedUser.id)
          .order("created_at", { ascending: false })
          .limit(20);

        if (!pointsErr && pointsData) {
          setLoyaltyTransactions(pointsData as LoyaltyPointRow[]);
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : "Error cargando tu cuenta";
        setAccountError(message);
      } finally {
        setAccountLoading(false);
        setOrdersLoading(false);
      }
    }

    void loadAccountData();
  }, [session]);

  function openAddressModal() {
    if (!session) {
      setAuthModalOpen(true);
      return;
    }
    setAddressInput(profile?.address ?? "");
    setAddressModalOpen(true);
  }

  async function saveAddress() {
    if (!session || !dbUser) {
      setAuthModalOpen(true);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const trimmedAddress = addressInput.trim();
    if (!trimmedAddress) {
      setAccountError("La dirección no puede estar vacía.");
      return;
    }

    setAddressSaving(true);
    setAccountError("");
    try {
      const { data: updated, error } = await supabase
        .from("profiles")
        .upsert(
          {
            user_id: dbUser.id,
            full_name: profile?.full_name || userData.name || "Cliente SwiftDrop",
            phone_number: profile?.phone_number ?? null,
            address: trimmedAddress,
            document_type: profile?.document_type ?? null,
            document_number: profile?.document_number ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        )
        .select("user_id, full_name, phone_number, address, document_type, document_number")
        .single();

      if (error) throw error;
      setProfile(updated as DbProfileRow);
      setAddressModalOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error guardando la dirección";
      setAccountError(message);
    } finally {
      setAddressSaving(false);
    }
  }

  async function clearAddress() {
    if (!session || !dbUser) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ address: null, updated_at: new Date().toISOString() })
      .eq("user_id", dbUser.id)
      .select("user_id, full_name, phone_number, address, document_type, document_number")
      .single();

    if (error) {
      setAccountError(error.message);
      return;
    }
    setProfile(updated as DbProfileRow);
  }

  async function saveProfile() {
    if (!session || !dbUser) {
      setAuthModalOpen(true);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setProfileSaving(true);
    setAccountError("");
    setProfileSavedMsg("");
    try {
      const { error: authErr } = await supabase.auth.updateUser({
        data: { full_name: profileForm.fullName },
      });
      if (authErr) throw authErr;

      const { data: updated, error: profErr } = await supabase
        .from("profiles")
        .upsert(
          {
            user_id: dbUser.id,
            full_name: profileForm.fullName.trim() || userData.name,
            phone_number: profileForm.phone.trim() || null,
            address: profile?.address ?? null,
            document_type: profileForm.documentType || null,
            document_number: profileForm.documentNumber.trim() || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        )
        .select("user_id, full_name, phone_number, address, document_type, document_number")
        .single();

      if (profErr) throw profErr;
      setProfile(updated as DbProfileRow);
      setProfileSavedMsg("Datos guardados correctamente.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error guardando datos";
      setAccountError(message);
    } finally {
      setProfileSaving(false);
    }
  }

  const menuItems = useMemo(
    () =>
      [
        { id: "pedidos" as const, label: "Mis Pedidos", icon: Package },
        { id: "direcciones" as const, label: "Direcciones", icon: MapPin },
        { id: "puntos" as const, label: "Puntos y Fidelidad", icon: Star },
        { id: "detalles" as const, label: "Datos Personales", icon: Settings },
      ] satisfies Array<{ id: TabId; label: string; icon: typeof Package }>,
    [],
  );

  const loyaltyPoints = dbUser?.points ?? 0;
  const userRole = dbUser?.role ?? "MINORISTA";

  return (
    <div className="pb-24 mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 min-h-[80vh]">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10">
        <aside className="lg:col-span-4">
          {dbUser?.role === "ADMIN" && (
              <div className="mt-6">
                <Link
                  href="/admin"
                  className="w-full flex items-center justify-between px-5 py-3.5 bg-black text-white text-[10px] uppercase tracking-[0.2em] hover:bg-gray-800 transition-colors"
                >
                  <span>Panel de Admin</span>
                  <ExternalLink size={15} strokeWidth={1.5} />
                </Link>
              </div>
            )}
          <div className="border border-gray-100 bg-white p-6 md:p-8">
            <div className="flex items-center gap-5">
              <div className="relative w-16 h-16 md:w-20 md:h-20 shrink-0">
                <Avatar
                  className="w-full h-full"
                  name={userData.name ?? "Cuenta"}
                  src={userData.avatar_url}
                />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg md:text-xl font-normal truncate">
                  {userData.name}
                </h2>
                <p className="text-[10px] md:text-xs text-gray-400 uppercase mt-1">
                  {session ? `Cuenta ${userRole}` : "Invitado"}
                </p>
                <p className="text-xs text-gray-500 mt-2 truncate">{userData.email}</p>
                <div className="mt-4 border border-gray-100 rounded-2xl p-4 bg-[#fafafa]">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-gray-400 mb-2">
                    Puntos
                  </p>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-light">{loyaltyPoints}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8">
              <p className="text-[10px] uppercase text-gray-400 mb-3">Cuenta</p>

              <nav className="hidden lg:block space-y-2">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      type="button"
                      className={`w-full flex items-center justify-between p-4 transition-colors border ${
                        isActive
                          ? "bg-[#fafafa] border-gray-100"
                          : "bg-white border-transparent hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon
                          size={18}
                          strokeWidth={1}
                          className={isActive ? "text-black" : "text-gray-400"}
                        />
                        <span
                          className={`text-[10px] uppercase ${
                            isActive ? "text-black" : "text-gray-500"
                          }`}
                        >
                          {item.label}
                        </span>
                      </div>
                      {isActive && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                    </button>
                  );
                })}

                {session ? (
                  <button
                    type="button"
                    onClick={async () => {
                      const supabase = getSupabaseBrowserClient();
                      await supabase?.auth.signOut();
                    }}
                    className="w-full flex items-center gap-3 p-4 hover:bg-red-50 text-red-500 transition-colors mt-6"
                  >
                    <LogOut size={18} strokeWidth={1} />
                    <span className="text-[10px] uppercase">Cerrar Sesión</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAuthModalOpen(true)}
                    className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 text-black transition-colors mt-6 border border-gray-100"
                  >
                    <Plus size={18} strokeWidth={1} className="text-gray-500" />
                    <span className="text-[10px] uppercase">Iniciar sesión</span>
                  </button>
                )}
              </nav>

              <div className="lg:hidden -mx-6 md:-mx-8 mt-6 px-6 md:px-8">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {menuItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        type="button"
                        className={`shrink-0 flex items-center gap-2 px-4 py-3 rounded-full border transition-colors ${
                          isActive
                            ? "border-black bg-black text-white"
                            : "border-gray-200 bg-white text-gray-600"
                        }`}
                      >
                        <Icon size={16} strokeWidth={1} />
                        <span className="text-[10px] uppercase">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="lg:col-span-8">
          <div className="border border-gray-100 bg-white p-6 md:p-10">
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {!supabaseReady && (
                <div className="mb-8 border border-amber-100 bg-amber-50 p-5 text-amber-900">
                  <p className="text-[10px] uppercase text-amber-700 mb-2">
                    Configuración
                  </p>
                  <p className="text-sm">{getSupabaseMissingEnvMessage()}</p>
                </div>
              )}

              {accountError && (
                <div className="mb-8 border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {accountError}
                </div>
              )}

              {!session && (
                <div className="mb-8 border border-gray-100 bg-[#fafafa] p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase text-gray-400 mb-2">Cuenta</p>
                    <p className="text-base font-normal">
                      Inicia sesión para ver tus pedidos y datos.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAuthModalOpen(true)}
                    className="rounded-full bg-black px-6 py-2 text-white text-xs uppercase"
                  >
                    Iniciar sesión
                  </button>
                </div>
              )}

              {activeTab === "pedidos" && (
                <div>
                  <div className="flex items-end justify-between gap-6 mb-8 md:mb-10">
                    <div>
                      <p className="text-[10px] uppercase text-gray-400 mb-3">
                        Historial
                      </p>
                      <h1 className="text-2xl md:text-3xl font-normal">Mis Pedidos</h1>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {(ordersLoading || accountLoading) && (
                      <div className="text-sm text-gray-500">Cargando pedidos…</div>
                    )}

                    {!ordersLoading && !accountLoading && orders.length === 0 && (
                      <div className="border border-gray-100 p-6 text-sm text-gray-600">
                        Aún no tienes pedidos.
                      </div>
                    )}

                    {orders.map((order) => (
                      <Link
                        href={`/profile/orders/${order.id}`}
                        key={order.id}
                        className="border border-gray-100 p-5 md:p-7 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-black transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-5 min-w-0">
                          <div className="relative w-16 h-20 bg-[#f7f7f7] overflow-hidden shrink-0">
                            <img
                              src="/placeholder.svg"
                              alt="Producto del pedido"
                              width={64}
                              height={80}
                              className="absolute inset-0 h-full w-full object-cover opacity-90"
                              loading="lazy"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] text-gray-400 uppercase mb-1">
                              #{order.id.slice(0, 8).toUpperCase()} • {formatDate(order.created_at)}
                            </p>
                            <h3 className="text-base md:text-lg font-normal truncate">
                              {getOrderSummaryLabel(order)}
                            </h3>
                            <p className="text-xs text-gray-500 mt-1">
                              Total • {formatCOP(order.total_amount)}
                              {order.delivery_pin ? ` • PIN: ${order.delivery_pin}` : ""}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between md:justify-end md:gap-10">
                          <span
                            className={`text-[10px] uppercase px-4 py-1.5 rounded-full border ${
                              toHumanOrderStatus(order.status) === "Entregado"
                                ? "bg-green-50 text-green-700 border-green-100"
                                : "bg-gray-50 text-gray-500 border-gray-100"
                            }`}
                          >
                            {toHumanOrderStatus(order.status)}
                          </span>
                          <ExternalLink
                            size={18}
                            strokeWidth={1}
                            className="text-gray-300 group-hover:text-black transition-colors"
                          />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "direcciones" && (
                <div>
                  <p className="text-[10px] uppercase text-gray-400 mb-3">Envíos</p>
                  <h1 className="text-2xl md:text-3xl font-normal mb-8 md:mb-10">
                    Dirección de Entrega
                  </h1>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    {profile?.address ? (
                      <div className="border border-black bg-white p-6 md:p-8 relative">
                        <span className="absolute top-6 right-6 text-[8px] uppercase bg-black text-white px-2 py-1 rounded">
                          Principal
                        </span>
                        <h3 className="text-[10px] uppercase mb-4 text-gray-500">
                          Dirección guardada
                        </h3>
                        <p className="text-sm text-gray-600 font-normal leading-relaxed">
                          {profile.address}
                        </p>

                        <div className="mt-8 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={openAddressModal}
                            className="text-[10px] uppercase border-b border-gray-200 pb-1 hover:border-black transition-colors inline-flex items-center gap-2"
                          >
                            <Edit3 size={14} strokeWidth={1} /> Editar
                          </button>
                          <button
                            type="button"
                            onClick={clearAddress}
                            className="text-[10px] uppercase text-red-600 hover:text-red-700 inline-flex items-center gap-2"
                          >
                            <Trash2 size={14} strokeWidth={1} /> Eliminar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={openAddressModal}
                        className="border border-gray-100 bg-[#fafafa] p-6 md:p-8 flex flex-col items-center justify-center border-dashed text-gray-500 hover:border-black transition-colors cursor-pointer group"
                      >
                        <Plus
                          size={28}
                          strokeWidth={0.75}
                          className="mb-4 text-gray-400 group-hover:text-black transition-colors"
                        />
                        <span className="text-[10px] uppercase">
                          Añadir dirección de entrega
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "puntos" && (
                <div>
                  <p className="text-[10px] uppercase text-gray-400 mb-3">Fidelización</p>
                  <h1 className="text-2xl md:text-3xl font-normal mb-8 md:mb-10">
                    Mis Puntos
                  </h1>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                    <div className="border border-gray-100 bg-white p-6">
                      <p className="text-xs text-gray-400 uppercase">Puntos actuales</p>
                      <p className="text-3xl font-normal mt-2">{loyaltyPoints}</p>
                    </div>
                    <div className="border border-gray-100 bg-white p-6">
                      <p className="text-xs text-gray-400 uppercase">Tipo de cliente</p>
                      <p className="text-3xl font-normal mt-2 capitalize">
                        {userRole === "MAYORISTA" ? "Mayorista" : "Minorista"}
                      </p>
                      <p className="text-xs text-gray-400 mt-2">
                        {userRole === "MAYORISTA"
                          ? "Acumulas 2x puntos por compra"
                          : "Acumulas 1x punto por compra"}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h2 className="text-lg font-normal mb-4">Historial de transacciones</h2>
                    {loyaltyTransactions.length === 0 && (
                      <p className="text-sm text-gray-500">
                        Aún no tienes transacciones de puntos.
                      </p>
                    )}
                    <div className="space-y-3">
                      {loyaltyTransactions.map((tx) => (
                        <div
                          key={tx.id}
                          className="flex items-center justify-between border border-gray-100 p-4"
                        >
                          <div>
                            <p className="text-sm">{tx.description || tx.type}</p>
                            <p className="text-xs text-gray-400">
                              {new Date(tx.created_at).toLocaleDateString("es-CO")}
                            </p>
                          </div>
                          <span
                            className={`text-sm font-medium ${
                              tx.points_delta > 0 ? "text-green-600" : "text-red-600"
                            }`}
                          >
                            {tx.points_delta > 0 ? "+" : ""}
                            {tx.points_delta} pts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "detalles" && (
                <div className="max-w-2xl">
                  <p className="text-[10px] uppercase text-gray-400 mb-3">Perfil</p>
                  <h1 className="text-2xl md:text-3xl font-normal mb-8 md:mb-10">
                    Datos Personales
                  </h1>

                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase text-gray-400">
                          Nombre completo
                        </label>
                        <input
                          type="text"
                          value={profileForm.fullName}
                          onChange={(e) =>
                            setProfileForm((p) => ({ ...p, fullName: e.target.value }))
                          }
                          className="w-full border border-gray-200 px-4 py-3 text-sm outline-none focus:border-black transition-colors"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] uppercase text-gray-400">
                          Teléfono
                        </label>
                        <input
                          type="tel"
                          value={profileForm.phone}
                          onChange={(e) =>
                            setProfileForm((p) => ({ ...p, phone: e.target.value }))
                          }
                          className="w-full border border-gray-200 px-4 py-3 text-sm outline-none focus:border-black transition-colors"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] uppercase text-gray-400">
                          Tipo de documento
                        </label>
                        <select
                          value={profileForm.documentType}
                          onChange={(e) =>
                            setProfileForm((p) => ({
                              ...p,
                              documentType: e.target.value as "" | "CC" | "NIT" | "CE",
                            }))
                          }
                          className="w-full border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-black transition-colors"
                        >
                          <option value="">Seleccionar...</option>
                          <option value="CC">Cédula de Ciudadanía (CC)</option>
                          <option value="NIT">NIT</option>
                          <option value="CE">Cédula de Extranjería (CE)</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] uppercase text-gray-400">
                          Número de documento
                        </label>
                        <input
                          type="text"
                          value={profileForm.documentNumber}
                          onChange={(e) =>
                            setProfileForm((p) => ({
                              ...p,
                              documentNumber: e.target.value,
                            }))
                          }
                          className="w-full border border-gray-200 px-4 py-3 text-sm outline-none focus:border-black transition-colors"
                        />
                      </div>
                    </div>

                    {profileSavedMsg && (
                      <p className="text-xs text-green-600">{profileSavedMsg}</p>
                    )}

                    <button
                      type="button"
                      disabled={profileSaving}
                      onClick={saveProfile}
                      className="rounded-full bg-black px-8 py-3 text-xs uppercase text-white hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      {profileSaving ? "Guardando..." : "Guardar cambios"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Modal para editar dirección en public.profiles */}
      <Modal isOpen={addressModalOpen} onOpenChange={setAddressModalOpen}>
        <ModalContent>
          <ModalHeader className="text-base font-normal">
            Dirección de Entrega
          </ModalHeader>
          <ModalBody className="pb-6 space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] uppercase text-gray-400">
                Dirección completa (Calle, barrio, ciudad)
              </label>
              <textarea
                rows={3}
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="Ej. Cra 27 # 45-10, Cabecera, Bucaramanga"
                className="w-full border border-gray-200 p-3 text-sm outline-none focus:border-black"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setAddressModalOpen(false)}
                className="px-5 py-2 text-xs uppercase text-gray-500 hover:text-black"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={addressSaving}
                onClick={saveAddress}
                className="rounded-full bg-black px-6 py-2 text-xs uppercase text-white disabled:opacity-50"
              >
                {addressSaving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
}