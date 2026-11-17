"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { useCart } from "@/src/features/cart";

export default function CheckoutSuccessPage() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id");
  const { clear } = useCart();

  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white p-8 shadow-sm text-center space-y-5">
        <CheckCircle2 size={48} className="mx-auto text-emerald-600" />
        <h1 className="text-2xl font-normal">¡Pago recibido!</h1>
        <p className="text-sm text-gray-600">
          Tu pago de prueba en Stripe se procesó correctamente.
          {orderId && (
            <span className="block mt-1 font-mono text-xs text-gray-500">
              Orden: #ORD-{orderId.slice(0, 8).toUpperCase()}
            </span>
          )}
        </p>
        <div className="pt-2 flex flex-col gap-2">
          <Link
            href="/catalog"
            className="w-full py-3 rounded-full bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Seguir comprando
          </Link>
        </div>
      </div>
    </div>
  );
}