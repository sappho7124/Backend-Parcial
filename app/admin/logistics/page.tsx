"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/browser";
import { useAdminAccess } from "@/src/features/admin/ui/client/useAdminAccess";

export default function LogisticsPage() {
  const access = useAdminAccess();
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [availableDrones, setAvailableDrones] = useState(0);

  async function load() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const [{ data: o }, { data: d }] = await Promise.all([
      supabase
        .from("orders")
        .select("id, total_amount, status, delivery_vehicle, delivery_pin, created_at")
        .in("status", ["PENDING", "IN_TRANSIT"])
        .order("created_at", { ascending: false }),
      supabase.from("drone_fleet").select("id").eq("status", "AVAILABLE"),
    ]);

    setOrders(o ?? []);
    setAvailableDrones((d ?? []).length);
  }

  useEffect(() => {
    void load();
  }, [access.status]);

  if (access.status !== "ready") return <div className="bg-white p-6">Acceso restringido.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-normal">Logística Multimodal</h2>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-black">
          <RefreshCw size={16} /> Actualizar
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-lg p-5 shadow-sm">
        <p className="text-xs text-gray-400 uppercase">Drones disponibles en flota</p>
        <p className="text-2xl font-medium mt-1">{availableDrones}</p>
      </div>

      <div className="space-y-3">
        {orders.map((o) => (
          <div key={String(o.id)} className="bg-white border border-gray-100 rounded-lg p-4 flex justify-between items-center">
            <div>
              <p className="text-sm font-medium">Orden #{String(o.id).slice(0, 8)}</p>
              <p className="text-xs text-gray-500">Vehículo: {String(o.delivery_vehicle)} | PIN: {String(o.delivery_pin)}</p>
            </div>
            <span className="text-xs px-3 py-1 rounded-full bg-gray-100">{String(o.status)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}