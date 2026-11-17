"use client";

import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, getSupabaseMissingEnvMessage } from "@/src/lib/supabase/browser";

type AdminAccessState =
  | {
      status: "missing-env";
      message: string;
      session: null;
      isAdmin: false;
      userId: null;
      role: null;
    }
  | {
      status: "loading";
      message: "";
      session: Session | null;
      isAdmin: boolean;
      userId: string | null;
      role: string | null;
    }
  | {
      status: "unauthenticated";
      message: "";
      session: null;
      isAdmin: false;
      userId: null;
      role: null;
    }
  | {
      status: "forbidden";
      message: "";
      session: Session;
      isAdmin: false;
      userId: string;
      role: string | null;
    }
  | {
      status: "ready";
      message: "";
      session: Session;
      isAdmin: true;
      userId: string;
      role: string;
    };

function useFetchAdminAccess(): AdminAccessState {
  const [state, setState] = useState<AdminAccessState>(() => {
    const msg = getSupabaseMissingEnvMessage();
    if (msg) {
      return {
        status: "missing-env",
        message: msg,
        session: null,
        isAdmin: false,
        userId: null,
        role: null,
      };
    }

    return {
      status: "loading",
      message: "",
      session: null,
      isAdmin: false,
      userId: null,
      role: null,
    };
  });

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const supabaseClient = getSupabaseBrowserClient();
    if (!supabaseClient) return;

    const supabase = supabaseClient;
    let cancelled = false;

    async function refresh(nextSession: Session | null, opts?: { keepStatus?: boolean }) {
      if (cancelled) return;

      const prev = stateRef.current;

      const canKeepStatus =
        opts?.keepStatus === true &&
        (prev.status === "ready" || prev.status === "forbidden") &&
        !!nextSession &&
        prev.userId === nextSession.user.id;

      if (!nextSession) {
        console.warn("[AdminAccess:Client] No browser session found -> unauthenticated");
        setState({
          status: "unauthenticated",
          message: "",
          session: null,
          isAdmin: false,
          userId: null,
          role: null,
        });
        return;
      }

      if (canKeepStatus) {
        setState((current) => {
          if (current.status !== "ready" && current.status !== "forbidden") return current;
          if (current.userId !== nextSession.user.id) return current;
          return { ...current, session: nextSession };
        });
      } else {
        setState((prevState) => ({
          status: "loading",
          message: "",
          session: nextSession,
          isAdmin: prevState.isAdmin,
          userId: nextSession.user.id,
          role: prevState.role,
        }));
      }

      const userId = nextSession.user.id;
      const userEmail = (nextSession.user.email ?? "").trim().toLowerCase();

      let { data, error } = await supabase
        .from("users")
        .select("id, email, role")
        .eq("id", userId)
        .maybeSingle();

      if (!data && userEmail) {
        const byEmail = await supabase
          .from("users")
          .select("id, email, role")
          .eq("email", userEmail)
          .maybeSingle();
        data = byEmail.data;
        error = byEmail.error;
      }

      if (cancelled) return;

      if (error || !data || data.role !== "ADMIN") {
        console.warn("[AdminAccess:Client] Access denied -> forbidden", {
          userId,
          userEmail,
          dbRow: data ?? null,
          dbError: error?.message ?? null,
        });
        setState({
          status: "forbidden",
          message: "",
          session: nextSession,
          isAdmin: false,
          userId,
          role: data?.role ?? null,
        });
        return;
      }

      console.log("[AdminAccess:Client] Access granted -> ready", {
        userId,
        email: data.email,
        role: data.role,
      });

      setState({
        status: "ready",
        message: "",
        session: nextSession,
        isAdmin: true,
        userId,
        role: data.role,
      });
    }

    supabase.auth.getSession().then(({ data }) => {
      void refresh(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const keepStatus = event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION";
      void refresh(nextSession, { keepStatus });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

const AdminAccessContext = createContext<AdminAccessState | null>(null);

export function AdminAccessProvider({ children }: { children: ReactNode }) {
  const state = useFetchAdminAccess();
  return createElement(AdminAccessContext.Provider, { value: state }, children);
}

export function useAdminAccess(): AdminAccessState {
  const context = useContext(AdminAccessContext);
  if (!context) {
    throw new Error("useAdminAccess must be used within an AdminAccessProvider");
  }
  return context;
}

export function getAdminBootstrapSql(userId: string) {
  return `-- Asignar rol ADMIN en public.users
UPDATE public.users
SET role = 'ADMIN'
WHERE id = '${userId}';
`;
}