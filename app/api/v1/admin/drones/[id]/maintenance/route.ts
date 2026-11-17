import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "BD no configurada" }, { status: 500 });

  const body = await req.json().catch(() => null);
  const status = body?.status;

  if (!["AVAILABLE", "MAINTENANCE", "FLIGHT"].includes(status)) {
    return NextResponse.json({ error: "status debe ser AVAILABLE, MAINTENANCE o FLIGHT" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = { status };
  if (status === "MAINTENANCE") {
    updateData.last_maintenance = new Date().toISOString().split("T")[0];
  }

  const { data: drone, error } = await supabase
    .from("drone_fleet")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error || !drone) return NextResponse.json({ error: "Dron no encontrado" }, { status: 404 });

  if (body?.maintenance_type) {
    await supabase.from("maintenance_logs").insert({
      drone_id: id,
      maintenance_type: body.maintenance_type,
      description: body.description ?? null,
      next_due_date: body.next_due_date ?? null,
      technician: body.technician ?? null,
    });
  }

  return NextResponse.json({ drone }, { status: 200 });
}