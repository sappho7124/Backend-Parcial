"use server";

import { getSupabaseServerClientWithCookies } from "@/src/lib/supabase/ssr";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";
import { sendOrderConfirmationEmail } from "@/src/lib/email/resend";
import { sendDeliveryPinSms } from "@/src/lib/sms";
import { accrueLoyaltyPoints } from "@/src/features/loyalty/server/actions";
import { assignDelivery } from "@/src/features/logistics/server/actions";
import { calculateShippingQuote } from "../lib/shipping";

interface OrderItem {
  id: string;
  productId: string | number;
  title?: string;
  quantity: number;
  unitPrice?: number;
  imageUrl?: string;
  size?: string;
  color?: string;
}

interface AddressData {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country: string;
}

interface CreateOrderParams {
  items: OrderItem[];
  email: string;
  address: AddressData;
  paymentProvider?: "manual" | "epayco";
  appliedDiscountCents?: number;
  redeemedPoints?: number;
  promoCode?: string;
}

type SanitizedCheckoutItem = {
  productId: string;
  quantity: number;
  size: string | null;
  color: string | null;
};

type DbProduct = {
  id: string;
  name: string;
  price: number | string;
  weight_kg: number | string;
  stock: number;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeCheckoutItems(items: OrderItem[]): SanitizedCheckoutItem[] {
  return items
    .map((item) => ({
      productId: String(item.productId ?? "").trim(),
      quantity: Math.max(1, Math.floor(Number(item.quantity))),
      size: typeof item.size === "string" && item.size.trim() ? item.size.trim() : null,
      color: typeof item.color === "string" && item.color.trim() ? item.color.trim() : null,
    }))
    .filter(
      (item) =>
        UUID_REGEX.test(item.productId) &&
        Number.isFinite(item.quantity) &&
        item.quantity > 0,
    );
}

function selectDeliveryVehicle(totalWeightKg: number): "DRONE" | "MOTORCYCLE" | "BICYCLE" {
  if (totalWeightKg <= 5) return "DRONE";
  if (totalWeightKg <= 25) return "MOTORCYCLE";
  return "BICYCLE";
}

export async function createOrder({
  items,
  email,
  address,
  paymentProvider = "manual",
  appliedDiscountCents = 0,
  redeemedPoints = 0,
  promoCode,
}: CreateOrderParams) {
  const authSupabase = await getSupabaseServerClientWithCookies();
  const db = getSupabaseServerClient() ?? authSupabase;

  if (!authSupabase || !db) {
    return {
      success: false,
      error: "No se pudo conectar con la base de datos (Error de configuración).",
    };
  }

  try {
    const {
      data: { user },
    } = await authSupabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Debes iniciar sesión para completar el pedido." };
    }

    const checkoutEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const accountEmail = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
    const orderEmail = checkoutEmail || accountEmail;

    if (!orderEmail) {
      return { success: false, error: "El correo electrónico es obligatorio." };
    }

    const safeItems = sanitizeCheckoutItems(items);
    if (safeItems.length === 0) {
      return { success: false, error: "No hay productos válidos en el pedido." };
    }

    // 1. Asegurar que el usuario exista en public.users (requerido por FK de orders.user_id)
    const { data: existingUserById } = await db
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    let dbUserId = existingUserById?.id as string | undefined;

    if (!dbUserId) {
      const { data: existingUserByEmail } = await db
        .from("users")
        .select("id")
        .eq("email", orderEmail)
        .maybeSingle();

      if (existingUserByEmail?.id) {
        dbUserId = existingUserByEmail.id as string;
      } else {
        const { data: insertedUser, error: userInsertError } = await db
          .from("users")
          .insert({
            id: user.id,
            email: orderEmail,
            password_hash: "supabase_auth_managed",
            role: "MINORISTA",
          })
          .select("id")
          .single();

        if (userInsertError || !insertedUser) {
          throw new Error(userInsertError?.message || "No se pudo registrar el usuario en la base de datos.");
        }
        dbUserId = insertedUser.id as string;
      }
    }

    // 2. Actualizar/crear perfil en public.profiles con los datos de envío
    const fullAddress = [address.line1, address.line2, address.city, address.region, address.country]
      .filter(Boolean)
      .join(", ");

    await db.from("profiles").upsert(
      {
        user_id: dbUserId,
        full_name: address.name || orderEmail,
        phone_number: address.phone || null,
        address: fullAddress || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    // 3. Consultar productos reales en public.products para calcular precios y peso
    const productIds = Array.from(new Set(safeItems.map((i) => i.productId)));
    const { data: dbProducts, error: productsError } = await db
      .from("products")
      .select("id, name, price, weight_kg, stock")
      .in("id", productIds);

    if (productsError || !dbProducts || dbProducts.length === 0) {
      throw new Error(productsError?.message || "No se encontraron los productos seleccionados.");
    }

    const productMap = new Map<string, DbProduct>(
      (dbProducts as DbProduct[]).map((p) => [p.id, p]),
    );

    let subtotalPesos = 0;
    let totalWeightKg = 0;

    const preparedItems = safeItems.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new Error(`Producto no disponible (${item.productId}).`);
      }

      const unitPrice = Number(product.price) || 0;
      const weightKg = Number(product.weight_kg) || 0;
      const subtotal = Number((unitPrice * item.quantity).toFixed(2));

      subtotalPesos += subtotal;
      totalWeightKg += weightKg * item.quantity;

      return {
        product_id: product.id,
        title: product.name,
        quantity: item.quantity,
        unit_price: unitPrice,
        subtotal,
      };
    });

    const shippingQuote = calculateShippingQuote({
      city: address.city,
      subtotalCents: Math.round(subtotalPesos * 100),
      items: safeItems.map((item) => ({ quantity: item.quantity })),
    });

    const shippingPesos = Math.round(shippingQuote.shippingCents / 100);
    const discountPesos = Math.max(0, Math.round(appliedDiscountCents / 100));
    const totalAmount = Number(
      Math.max(0, subtotalPesos + shippingPesos - discountPesos).toFixed(2),
    );
    const totalCents = Math.round(totalAmount * 100);

    const deliveryPin = Math.floor(100000 + Math.random() * 900000).toString();
    const deliveryVehicle = selectDeliveryVehicle(totalWeightKg);

    // 4. Crear orden en public.orders
    const { data: createdOrder, error: orderInsertError } = await db
      .from("orders")
      .insert({
        user_id: dbUserId,
        total_amount: totalAmount,
        status: "PENDING",
        delivery_vehicle: deliveryVehicle,
        delivery_pin: deliveryPin,
        metadata: {
          payment_provider: paymentProvider,
          redeemed_points: redeemedPoints,
          promo_code: promoCode || null,
          customer_name: address.name,
          customer_phone: address.phone,
          shipping_address: fullAddress,
          shipping_pesos: shippingPesos,
          discount_pesos: discountPesos,
          total_weight_kg: Number(totalWeightKg.toFixed(2)),
          notes:
            paymentProvider === "epayco"
              ? "Pago con ePayco (sandbox)"
              : "Pedido Contra Entrega",
        },
      })
      .select("id")
      .single();

    if (orderInsertError || !createdOrder) {
      throw new Error(orderInsertError?.message || "No se pudo crear la orden.");
    }

    const orderId = createdOrder.id as string;

    // 5. Insertar ítems en public.order_items
    const { error: itemsInsertError } = await db.from("order_items").insert(
      preparedItems.map((item) => ({
        order_id: orderId,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
      })),
    );

    if (itemsInsertError) {
      throw new Error(itemsInsertError.message || "No se pudieron guardar los ítems del pedido.");
    }

    // 6. Registrar intención de pago en public.payments
    const { error: paymentInsertError } = await db.from("payments").insert({
      order_id: orderId,
      provider: paymentProvider === "epayco" ? "EPAYCO" : "MANUAL",
      amount: totalAmount,
      currency: "COP",
      status: "PENDING",
    });

    if (paymentInsertError) {
      throw new Error(paymentInsertError.message || "No se pudo registrar el pago pendiente.");
    }

    // SMS mock delivery PIN
    try {
      await sendDeliveryPinSms(address.phone, orderId, deliveryPin, "processing");
    } catch {
      // Best-effort
    }

    // Loyalty points accrual
    try {
      if (totalCents > 0) {
        await accrueLoyaltyPoints(orderId, dbUserId, totalCents);
      }
    } catch {
      // Best-effort
    }

    // Logistics assignment
    try {
      await assignDelivery({
        orderId,
        estimatedWeightKg: totalWeightKg || safeItems.reduce((sum, i) => sum + i.quantity * 0.8, 0),
        estimatedDistanceKm: 5 + Math.random() * 10,
        originLat: 7.12539,
        originLng: -73.1198,
        destLat: 7.12 + (Math.random() - 0.5) * 0.02,
        destLng: -73.12 + (Math.random() - 0.5) * 0.02,
      });
    } catch {
      // Best-effort
    }

    // Correo de confirmación para pedidos contra entrega
    if (paymentProvider !== "epayco") {
      try {
        const mailResult = await sendOrderConfirmationEmail({
          to: orderEmail,
          customerName: address.name,
          orderId,
          orderNumber: null,
          currency: "COP",
          totalCents,
          items: preparedItems.map((item) => ({
            title: item.title,
            quantity: item.quantity,
            lineTotalCents: Math.round(item.subtotal * 100),
          })),
        });

        const nextMetadata = {
          payment_provider: paymentProvider,
          redeemed_points: redeemedPoints,
          promo_code: promoCode || null,
          customer_name: address.name,
          customer_phone: address.phone,
          shipping_address: fullAddress,
          email_confirmation: {
            status: mailResult.ok ? "sent" : "failed",
            reason: mailResult.ok ? undefined : mailResult.reason || "unknown_email_error",
            at: new Date().toISOString(),
            to: orderEmail,
          },
        };

        await db.from("orders").update({ metadata: nextMetadata }).eq("id", orderId);
      } catch {
        // Ignorar fallos de correo en checkout
      }
    }

    return { success: true, orderId, paymentProvider };
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error("[Checkout] createOrder error:", error);
    const message = error instanceof Error ? error.message : "No se pudo procesar el pedido.";
    return { success: false, error: message };
  }
}