import type { SupabaseClient } from "@supabase/supabase-js";

export type VehicleType = "DRONE" | "MOTORCYCLE" | "BICYCLE";

export class LogisticsService {
  // Coordenadas base Bucaramanga (Origen: Cabecera/UNAB -> Destino simulado)
  private static ORIGIN = { lat: 7.119349, lng: -73.122742 };

  static generatePin(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  static async assignDelivery(supabase: SupabaseClient, totalWeightKg: number) {
    let delivery_vehicle: VehicleType = "MOTORCYCLE";
    let drone_id: string | null = null;

    if (totalWeightKg <= 2.0) {
      delivery_vehicle = "BICYCLE";
    }

    // Si pesa hasta 15kg, intentar asignar un dron disponible en drone_fleet
    if (totalWeightKg <= 15.0) {
      const { data: availableDrone } = await supabase
        .from("drone_fleet")
        .select("id, max_weight_kg")
        .eq("status", "AVAILABLE")
        .gte("max_weight_kg", totalWeightKg)
        .order("max_weight_kg", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (availableDrone) {
        delivery_vehicle = "DRONE";
        drone_id = availableDrone.id;
        await supabase.from("drone_fleet").update({ status: "FLIGHT" }).eq("id", drone_id);
      }
    }

    return {
      delivery_vehicle,
      drone_id,
      delivery_pin: this.generatePin(),
    };
  }

  static async seedInitialRoute(
    supabase: SupabaseClient,
    orderId: string,
    vehicleType: VehicleType,
  ) {
    const steps = 5;
    const destLat = this.ORIGIN.lat + (Math.random() * 0.02 - 0.01);
    const destLng = this.ORIGIN.lng + (Math.random() * 0.02 - 0.01);
    const now = Date.now();

    const points = Array.from({ length: steps }, (_, i) => {
      const ratio = i / (steps - 1);
      return {
        order_id: orderId,
        latitude: Number((this.ORIGIN.lat + (destLat - this.ORIGIN.lat) * ratio).toFixed(7)),
        longitude: Number((this.ORIGIN.lng + (destLng - this.ORIGIN.lng) * ratio).toFixed(7)),
        vehicle_type: vehicleType,
        recorded_at: new Date(now + i * 60_000).toISOString(),
      };
    });

    await supabase.from("gps_tracking").insert(points);
    return points;
  }
}