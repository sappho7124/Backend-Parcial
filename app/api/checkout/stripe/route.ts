import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stripe } from "@/src/lib/stripe";

type CheckoutItemInput = {
  productId: string;
  title?: string;
  quantity: number;
  unitPriceCents?: number;
  imageUrl?: string;
};

type CheckoutRequestBody = {
  userId?: string | null;
  email?: string | null;
  address?: {
    name?: string;
    phone?: string;
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  shippingCents?: number;
  discountCents?: number;
  promoCode?: string;
  items: CheckoutItemInput[];
};

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CheckoutRequestBody;

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "El carrito está vacío." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const productIds = body.items.map((i) => i.productId);

    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id, name, description, price, stock")
      .in("id", productIds);

    if (prodErr || !products) {
      return NextResponse.json(
        { error: "No se pudieron validar los productos en catálogo." },
        { status: 500 }
      );
    }

    const productMap = new Map(products.map((p) => [p.id, p]));
    const lineItems: {
      price_data: {
        currency: string;
        product_data: { name: string; description?: string };
        unit_amount: number;
      };
      quantity: number;
    }[] = [];

    const orderItemsToInsert: {
      product_id: string;
      quantity: number;
      unit_price: number;
      subtotal: number;
    }[] = [];

    let itemsTotalCents = 0;

    for (const item of body.items) {
      const prod = productMap.get(item.productId);
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

      if (!prod) {
        return NextResponse.json(
          { error: `Producto no encontrado: ${item.title || item.productId}` },
          { status: 404 }
        );
      }

      if ((prod.stock ?? 0) < qty) {
        return NextResponse.json(
          { error: `Stock insuficiente para "${prod.name}".` },
          { status: 400 }
        );
      }

      const unitPricePesos = Number(prod.price) || 0;
      const unitPriceCents = Math.round(unitPricePesos * 100);
      const subtotalPesos = unitPricePesos * qty;

      itemsTotalCents += unitPriceCents * qty;

      orderItemsToInsert.push({
        product_id: prod.id,
        quantity: qty,
        unit_price: unitPricePesos,
        subtotal: subtotalPesos,
      });

      lineItems.push({
        price_data: {
          currency: "cop",
          product_data: {
            name: prod.name,
            ...(prod.description ? { description: prod.description } : {}),
          },
          unit_amount: unitPriceCents,
        },
        quantity: qty,
      });
    }

    const shippingCents = Math.max(0, Math.round(Number(body.shippingCents) || 0));
    if (shippingCents > 0) {
      lineItems.push({
        price_data: {
          currency: "cop",
          product_data: { name: "Envío" },
          unit_amount: shippingCents,
        },
        quantity: 1,
      });
    }

    const discountCents = Math.max(0, Math.round(Number(body.discountCents) || 0));
    const totalCents = Math.max(0, itemsTotalCents + shippingCents - discountCents);

    const formattedAddress = body.address
      ? [
          body.address.name,
          body.address.line1,
          body.address.line2,
          [body.address.city, body.address.region, body.address.postal_code]
            .filter(Boolean)
            .join(", "),
          body.address.phone ? `Tel: ${body.address.phone}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

    // 1. Crear orden pendiente en Supabase (valores en pesos)
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        user_id: body.userId || null,
        total_amount: Math.round(totalCents / 100),
        shipping_cost: Math.round(shippingCents / 100),
        shipping_address: formattedAddress,
        status: "Pendiente",
        payment_status: "pending",
        payment_method: "Stripe (Test)",
      })
      .select("id")
      .single();

    if (orderErr || !order) {
      return NextResponse.json(
        { error: orderErr?.message || "Error creando la orden." },
        { status: 500 }
      );
    }

    // 2. Insertar ítems de la orden
    const { error: itemsErr } = await supabase.from("order_items").insert(
      orderItemsToInsert.map((item) => ({
        ...item,
        order_id: order.id,
      }))
    );

    if (itemsErr) {
      await supabase.from("orders").delete().eq("id", order.id);
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    // 3. Si hay descuento aplicado, crear cupón de un solo uso en Stripe
    let discounts: { coupon: string }[] | undefined;
    if (discountCents > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: discountCents,
        currency: "cop",
        duration: "once",
        name: body.promoCode ? `Promo ${body.promoCode}` : "Descuento aplicado",
      });
      discounts = [{ coupon: coupon.id }];
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // 4. Crear sesión de Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      ...(discounts ? { discounts } : {}),
      ...(body.email ? { customer_email: body.email } : {}),
      metadata: {
        order_id: order.id,
      },
      success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
      cancel_url: `${appUrl}/checkout/cancel?order_id=${order.id}`,
    });

    await supabase
      .from("orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    return NextResponse.json({ url: session.url, orderId: order.id });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Error iniciando sesión con Stripe",
      },
      { status: 500 }
    );
  }
}