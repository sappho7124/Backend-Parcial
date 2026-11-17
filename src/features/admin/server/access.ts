import { getSupabaseServerClientWithCookies } from "@/src/lib/supabase/ssr";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

export type AdminServerAccess =
  | { status: "ready"; userId: string; email: string; role: string }
  | { status: "unauthenticated"; reason: string; userError?: string | null }
  | {
      status: "forbidden";
      reason: string;
      authUserId: string;
      email: string;
      dbRow: unknown;
      dbError?: string | null;
    }
  | { status: "missing-env"; reason: string };

export async function getAdminServerAccess(): Promise<AdminServerAccess> {
  const timestamp = new Date().toISOString();
  const authSupabase = await getSupabaseServerClientWithCookies();

  if (!authSupabase) {
    console.warn(`[AdminAccess:Server] ${timestamp} -> DENIED (missing-env)`);
    return {
      status: "missing-env",
      reason: "No se pudo inicializar el cliente Supabase SSR (faltan variables de entorno).",
    };
  }

  const {
    data: { user },
    error: userError,
  } = await authSupabase.auth.getUser();

  if (userError || !user) {
    console.warn(`[AdminAccess:Server] ${timestamp} -> DENIED (unauthenticated)`, {
      error: userError?.message ?? "No active session in cookies",
    });
    return {
      status: "unauthenticated",
      reason:
        "El servidor no detectó una sesión activa en las cookies. Es posible que la sesión esté guardada solo en localStorage del navegador y no en cookies SSR.",
      userError: userError?.message ?? null,
    };
  }

  const db = getSupabaseServerClient() ?? authSupabase;
  const normalizedEmail = user.email?.trim().toLowerCase() ?? "";

  let { data, error } = await db
    .from("users")
    .select("id, email, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!data && normalizedEmail) {
    const byEmail = await db
      .from("users")
      .select("id, email, role")
      .eq("email", normalizedEmail)
      .maybeSingle();
    data = byEmail.data;
    error = byEmail.error;
  }

  if (error || !data || data.role !== "ADMIN") {
    const reason = error
      ? `Error consultando public.users: ${error.message}`
      : !data
      ? `No existe ningún registro en public.users para id=${user.id} ni email=${normalizedEmail}`
      : `El usuario existe en public.users pero su rol es "${data.role}" en lugar de "ADMIN"`;

    console.warn(`[AdminAccess:Server] ${timestamp} -> DENIED (forbidden)`, {
      authUserId: user.id,
      email: normalizedEmail,
      dbRow: data ?? null,
      dbError: error?.message ?? null,
    });

    return {
      status: "forbidden",
      reason,
      authUserId: user.id,
      email: normalizedEmail,
      dbRow: data ?? null,
      dbError: error?.message ?? null,
    };
  }

  console.log(`[AdminAccess:Server] ${timestamp} -> GRANTED (ready)`, {
    authUserId: user.id,
    dbUserId: data.id,
    email: data.email,
    role: data.role,
  });

  return {
    status: "ready",
    userId: user.id,
    email: data.email,
    role: data.role,
  };
}