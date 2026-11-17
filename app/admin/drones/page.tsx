"use client";

import { useEffect, useState } from "react";
import { Plane, Wrench, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useAdminAccess } from "@/src/features/admin/ui/client/useAdminAccess";

type DroneFleetItem = {
  id: string;
  model: string;
  max_weight_kg: number;
  status: "AVAILABLE" | "MAINTENANCE" | "FLIGHT";
  last_maintenance: string | null;
};

export default function DronesPage() {
  const access = useAdminAccess();
  const [drones, setDrones] = useState<DroneFleetItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/drones");
      const data = await res.json();
      setDrones(data.drones ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [access.status]);

  if (access.status !== "ready") {
    return <div className="bg-white p-6 shadow-sm">Acceso restringido al panel de administración.</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-normal">Gestión de Flota de Drones</h2>
          <p className="text-sm text-gray-500 mt-1">Conectado a tabla drone_fleet.</p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-black">
          <RefreshCw size={16} /> Actualizar
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500">Cargando drones…</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {drones.map((drone) => (
          <Link
            key={drone.id}
            href={`/admin/drones/${drone.id}`}
            className="bg-white border border-gray-100 rounded-lg p-6 shadow-sm hover:border-black transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center">
                  <Plane size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-medium">{drone.model}</h3>
                  <p className="text-xs text-gray-400">ID: {drone.id.slice(0, 8)}</p>
                </div>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 font-medium">{drone.status}</span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-xs text-gray-500">
              <div className="bg-gray-50 rounded-md p-2.5">
                <div className="flex items-center gap-1.5 mb-1"><Wrench size={12} /><span>Carga máx</span></div>
                <span className="text-sm font-medium text-black">{drone.max_weight_kg} kg</span>
              </div>
              <div className="bg-gray-50 rounded-md p-2.5">
                <div className="mb-1">Últ. mantenimiento</div>
                <span className="text-sm font-medium text-black">{drone.last_maintenance ?? "N/A"}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}