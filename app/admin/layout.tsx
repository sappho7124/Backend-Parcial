import Link from "next/link";
import { AdminLayout } from "@/src/features/admin/ui/layout/AdminLayout";
import { AdminAccessProvider } from "@/src/features/admin/ui/client/useAdminAccess";
import { getAdminServerAccess } from "@/src/features/admin/server/access";
import { ReactNode } from "react";

export default async function Layout({ children }: { children: ReactNode }) {
  const access = await getAdminServerAccess();

  if (access.status !== "ready") {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center px-4 py-12">
        <div className="max-w-xl w-full bg-white border border-red-200 p-8 shadow-sm space-y-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-red-600 mb-2">
              Error de acceso • {access.status}
            </p>
            <h1 className="text-2xl font-normal text-gray-900">
              No se pudo abrir el Panel de Admin
            </h1>
          </div>

          <p className="text-sm text-gray-700 leading-relaxed">
            {access.reason}
          </p>

          <div className="bg-gray-50 border border-gray-200 p-4 overflow-auto">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">
              Diagnóstico del servidor
            </p>
            <pre className="text-xs text-gray-800 whitespace-pre-wrap break-all">
              {JSON.stringify(access, null, 2)}
            </pre>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Link
              href="/profile"
              className="rounded-full bg-black text-white px-6 py-2.5 text-xs uppercase tracking-wider hover:bg-gray-800 transition-colors"
            >
              Volver al perfil
            </Link>
            <Link
              href="/admin"
              className="rounded-full border border-gray-300 px-6 py-2.5 text-xs uppercase tracking-wider text-gray-700 hover:border-black transition-colors"
            >
              Reintentar
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdminAccessProvider>
      <AdminLayout>{children}</AdminLayout>
    </AdminAccessProvider>
  );
}