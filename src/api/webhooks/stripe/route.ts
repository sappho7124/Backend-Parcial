import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe } from "@/src/lib/stripe";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Falta firma de Stripe o STRIPE_WEBHOOK_SECRET" },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: `Webhook signature error: ${
          err instanceof Error ? err.message : "Invalid"
        }`,
      },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    if (orderId) {
      // Evitar procesar dos veces el mismo webhook
      const { data: existingOrder } = await supabase
        .from("orders")
        .select("id, payment_status")
        .eq("id", orderId)
        .single();

      if (existingOrder && existingOrder.payment_status !== "paid") {
        await supabase
          .from("orders")
          .update({
            payment_status: "paid",
            status: "Procesando",
            stripe_payment_intent_id: paymentIntentId,
          })
          .eq("id", orderId);

        // Descontar stock de cada ítem de la orden
        const { data: items } = await supabase
          .from("order_items")
          .select("product_id, quantity")
          .eq("order_id", orderId);

        if (items) {
          for (const item of items) {
            if (item.product_id) {
              await supabase.rpc("decrement_product_stock", {
                p_product_id: item.product_id,
                p_qty: item.quantity,
              });
            }
          }
        }
      }
    }
  }

  if (
    event.type === "checkout.session.expired" ||
    event.type === "payment_intent.payment_failed"
  ) {
    const obj = event.data.object as { metadata?: { order_id?: string } };
    const orderId = obj.metadata?.order_id;
    if (orderId) {
      await supabase
        .from("orders")
        .update({ payment_status: "failed" })
        .eq("id", orderId);
    }
  }

  return NextResponse.json({ received: true });
}