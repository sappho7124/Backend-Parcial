"use client";

import Link from "next/link";
import { XCircle } from "lucide-react";

export default function CheckoutCancelPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white p-8 shadow-sm text-center space-y-5">
        <XCircle size={48} className="mx-auto text-amber-500" />
        <h1 className="text-2xl font-normal">Pago cancelado</h1>
        <p className="text-sm text-gray-600">
          No se realizó ningún cargo. Tus productos siguen guardados en el carrito.
        </p>
        <div className="pt-2">
          <Link
            href="/checkout"
            className="inline-block w-full py-3 rounded-full bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Volver al checkout
          </Link>
        </div>
      </div>
    </div>
  );
}