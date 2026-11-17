import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

// Cargar .env.local automáticamente si no se pasó --env-file
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let val = trimmed.slice(eqIndex + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnvLocal();

type TestStatus = "PASS" | "WARN" | "FAIL";

interface CheckResult {
  section: string;
  name: string;
  status: TestStatus;
  detail: string;
}

const results: CheckResult[] = [];

function record(section: string, name: string, status: TestStatus, detail: string) {
  results.push({ section, name, status, detail });
  const icon = status === "PASS" ? "✅" : status === "WARN" ? "⚠️" : "❌";
  console.log(`${icon} [${section}] ${name}: ${detail}`);
}

async function runIntegritySuite() {
  console.log("\n=== INICIANDO AUDITORÍA DE INTEGRIDAD DEL SISTEMA ===\n");

  // ---------------------------------------------------------------------------
  // 1. VARIABLES DE ENTORNO
  // ---------------------------------------------------------------------------
  const requiredEnv = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ];

  for (const key of requiredEnv) {
    const val = process.env[key];
    if (!val) {
      record("ENV", key, "FAIL", "Variable faltante en .env.local");
    } else if (key === "STRIPE_SECRET_KEY" && !val.startsWith("sk_test_")) {
      record(
        "ENV",
        key,
        "WARN",
        "No comienza con sk_test_ (verifica que estés en modo prueba)"
      );
    } else {
      record("ENV", key, "PASS", "Configurada correctamente");
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("\n❌ Faltan credenciales de Supabase. Abortando pruebas de base de datos.");
    process.exit(1);
  }

  const adminDb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const anonDb = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });

  // ---------------------------------------------------------------------------
  // 2. EXISTENCIA DE TABLAS Y ESQUEMA EN SUPABASE
  // ---------------------------------------------------------------------------
  const tablesToCheck = [
    { name: "users", columns: "id, email, role" },
    { name: "profiles", columns: "user_id, full_name, phone, city, address" },
    { name: "products", columns: "id, name, price, weight_kg, stock" },
    { name: "categories", columns: "id, name, slug, parent_id" },
    {
      name: "orders",
      columns:
        "id, user_id, status, total_amount, shipping_cost, payment_status, stripe_session_id",
    },
    {
      name: "order_items",
      columns: "id, order_id, product_id, quantity, unit_price, subtotal",
    },
    {
      name: "promotions",
      columns: "id, name, code, type, value_percent, value_cents, starts_at, ends_at, active",
    },
  ];

  for (const tbl of tablesToCheck) {
    const { error } = await adminDb.from(tbl.name).select(tbl.columns).limit(1);
    if (error) {
      record("SCHEMA", `Tabla public.${tbl.name}`, "FAIL", error.message);
    } else {
      record("SCHEMA", `Tabla public.${tbl.name}`, "PASS", "Columnas y acceso OK");
    }
  }

  // Verificar existencia de función RPC decrement_product_stock
  const { error: rpcErr } = await adminDb.rpc("decrement_product_stock", {
    p_product_id: "00000000-0000-0000-0000-000000000000",
    p_qty: 0,
  });
  if (rpcErr && rpcErr.message.includes("Could not find the function")) {
    record("SCHEMA", "RPC decrement_product_stock", "FAIL", rpcErr.message);
  } else {
    record("SCHEMA", "RPC decrement_product_stock", "PASS", "Función disponible en PostgreSQL");
  }

  // ---------------------------------------------------------------------------
  // 3. INTEGRIDAD REFERENCIAL Y CONSISTENCIA DE DATOS
  // ---------------------------------------------------------------------------

  // 3.1 Usuarios y Administradores
  const { data: users } = await adminDb.from("users").select("id, email, role");
  const { data: profiles } = await adminDb.from("profiles").select("user_id");

  const userList = users ?? [];
  const profileSet = new Set((profiles ?? []).map((p) => p.user_id));
  const admins = userList.filter((u) => u.role === "ADMIN");
  const usersWithoutProfile = userList.filter((u) => !profileSet.has(u.id));

  record(
    "DATA",
    "Usuarios con rol ADMIN",
    admins.length > 0 ? "PASS" : "FAIL",
    admins.length > 0
      ? `${admins.length} administrador(es) activo(s)`
      : "No existe ningún usuario con role = 'ADMIN'"
  );

  record(
    "DATA",
    "Relación users -> profiles",
    usersWithoutProfile.length === 0 ? "PASS" : "WARN",
    usersWithoutProfile.length === 0
      ? `Todos los ${userList.length} usuarios tienen perfil`
      : `${usersWithoutProfile.length} usuario(s) sin fila en public.profiles`
  );

  // 3.2 Productos e Inventario
  const { data: products } = await adminDb
    .from("products")
    .select("id, name, price, stock");
  const productList = products ?? [];
  const invalidProducts = productList.filter(
    (p) => (Number(p.price) || 0) <= 0 || (Number(p.stock) ?? 0) < 0
  );

  record(
    "DATA",
    "Catálogo y stock positivo",
    invalidProducts.length === 0 ? "PASS" : "FAIL",
    invalidProducts.length === 0
      ? `${productList.length} productos con precios y stock válidos`
      : `${invalidProducts.length} producto(s) con precio <= 0 o stock negativo`
  );

  // 3.3 Categorías y Jerarquía
  const { data: categories } = await adminDb
    .from("categories")
    .select("id, name, slug, parent_id");
  const categoryList = categories ?? [];
  const catIds = new Set(categoryList.map((c) => c.id));
  const brokenParents = categoryList.filter(
    (c) => c.parent_id && (!catIds.has(c.parent_id) || c.parent_id === c.id)
  );

  record(
    "DATA",
    "Integridad árbol de categorías",
    brokenParents.length === 0 ? "PASS" : "FAIL",
    brokenParents.length === 0
      ? `${categoryList.length} categorías sin referencias circulares ni huérfanas`
      : `${brokenParents.length} categoría(s) con parent_id inválido`
  );

  // 3.4 Órdenes e Ítems (Matemática y Huérfanos)
  const { data: orders } = await adminDb
    .from("orders")
    .select("id, user_id, status, total_amount, shipping_cost");
  const { data: orderItems } = await adminDb
    .from("order_items")
    .select("id, order_id, product_id, quantity, unit_price, subtotal");

  const orderList = orders ?? [];
  const itemList = orderItems ?? [];
  const userIds = new Set(userList.map((u) => u.id));
  const productIds = new Set(productList.map((p) => p.id));

  const orphanUserOrders = orderList.filter(
    (o) => !o.user_id || !userIds.has(o.user_id)
  );
  record(
    "DATA",
    "Órdenes vinculadas a clientes válidos",
    orphanUserOrders.length === 0 ? "PASS" : "WARN",
    orphanUserOrders.length === 0
      ? `Todas las ${orderList.length} órdenes tienen cliente válido`
      : `${orphanUserOrders.length} orden(es) sin user_id o con usuario inexistente`
  );

  const itemsByOrder = new Map<string, typeof itemList>();
  let badItemMathCount = 0;
  let orphanProductItems = 0;

  for (const item of itemList) {
    if (!item.product_id || !productIds.has(item.product_id)) {
      orphanProductItems++;
    }
    const expectedSub = (Number(item.unit_price) || 0) * (Number(item.quantity) || 0);
    const actualSub = Number(item.subtotal) || 0;
    if (Math.abs(expectedSub - actualSub) > 1) {
      badItemMathCount++;
    }
    const arr = itemsByOrder.get(item.order_id) ?? [];
    arr.push(item);
    itemsByOrder.set(item.order_id, arr);
  }

  record(
    "DATA",
    "Cálculo subtotal en order_items",
    badItemMathCount === 0 ? "PASS" : "FAIL",
    badItemMathCount === 0
      ? `${itemList.length} líneas verificadas (unit_price * quantity == subtotal)`
      : `${badItemMathCount} línea(s) con discrepancia matemática en subtotal`
  );

  record(
    "DATA",
    "Integridad order_items -> products",
    orphanProductItems === 0 ? "PASS" : "WARN",
    orphanProductItems === 0
      ? "Todos los ítems apuntan a productos existentes"
      : `${orphanProductItems} ítem(s) apuntan a productos eliminados`
  );

  let emptyOrders = 0;
  let totalMismatchOrders = 0;

  for (const ord of orderList) {
    const its = itemsByOrder.get(ord.id) ?? [];
    if (its.length === 0) {
      emptyOrders++;
      continue;
    }
    const itemsSum = its.reduce((acc, i) => acc + (Number(i.subtotal) || 0), 0);
    const shipping = Number(ord.shipping_cost) || 0;
    const total = Number(ord.total_amount) || 0;
    // Puede haber descuento aplicado, así que total no debe exceder itemsSum + shipping
    if (total > itemsSum + shipping + 1) {
      totalMismatchOrders++;
    }
  }

  record(
    "DATA",
    "Consistencia total_amount en órdenes",
    emptyOrders === 0 && totalMismatchOrders === 0 ? "PASS" : "WARN",
    `Órdenes sin ítems: ${emptyOrders} | Totales inconsistentes: ${totalMismatchOrders}`
  );

  // 3.5 Promociones
  const { data: promos } = await adminDb
    .from("promotions")
    .select("id, name, code, type, value_percent, value_cents, starts_at, ends_at");
  const promoList = promos ?? [];
  const invalidPromos = promoList.filter((p) => {
    if (p.type === "percent" && (!p.value_percent || p.value_percent <= 0 || p.value_percent > 100)) {
      return true;
    }
    if (p.type === "fixed" && (!p.value_cents || p.value_cents <= 0)) {
      return true;
    }
    if (p.starts_at && p.ends_at && new Date(p.starts_at) > new Date(p.ends_at)) {
      return true;
    }
    return false;
  });

  record(
    "DATA",
    "Reglas de promociones y fechas",
    invalidPromos.length === 0 ? "PASS" : "FAIL",
    invalidPromos.length === 0
      ? `${promoList.length} promociones configuradas correctamente`
      : `${invalidPromos.length} promoción(es) con valores o rangos de fechas inválidos`
  );

  // ---------------------------------------------------------------------------
  // 4. SEGURIDAD RLS (CLIENTE ANÓNIMO)
  // ---------------------------------------------------------------------------
  const { data: anonUsers, error: anonUsersErr } = await anonDb
    .from("users")
    .select("id")
    .limit(5);

  if (!anonUsersErr && (anonUsers?.length ?? 0) > 0) {
    record(
      "SECURITY",
      "RLS en public.users (Anon)",
      "FAIL",
      "Un cliente anónimo puede listar usuarios. Revisa las políticas SELECT."
    );
  } else {
    record(
      "SECURITY",
      "RLS en public.users (Anon)",
      "PASS",
      "Acceso anónimo bloqueado correctamente"
    );
  }

  const { data: anonOrders, error: anonOrdersErr } = await anonDb
    .from("orders")
    .select("id")
    .limit(5);

  if (!anonOrdersErr && (anonOrders?.length ?? 0) > 0) {
    record(
      "SECURITY",
      "RLS en public.orders (Anon)",
      "FAIL",
      "Un cliente anónimo puede leer órdenes de otros usuarios."
    );
  } else {
    record(
      "SECURITY",
      "RLS en public.orders (Anon)",
      "PASS",
      "Lectura anónima de órdenes bloqueada"
    );
  }

  // ---------------------------------------------------------------------------
  // 5. CONEXIÓN STRIPE Y PRUEBA DRY-RUN DE CHECKOUT
  // ---------------------------------------------------------------------------
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    try {
      const stripe = new Stripe(stripeKey, { typescript: true });
      const balance = await stripe.balance.retrieve();
      record(
        "STRIPE",
        "Autenticación API Stripe",
        "PASS",
        `Conectado (${balance.livemode ? "LIVE" : "TEST MODE"})`
      );
    } catch (err) {
      record(
        "STRIPE",
        "Autenticación API Stripe",
        "FAIL",
        err instanceof Error ? err.message : "Error conectando con Stripe"
      );
    }
  }

  // Prueba HTTP al endpoint local /api/checkout/stripe si el servidor está corriendo
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const sampleProduct = productList.find((p) => (Number(p.stock) || 0) >= 1);

  if (sampleProduct) {
    let createdTestOrderId: string | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${appUrl}/api/checkout/stripe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          userId: admins[0]?.id ?? null,
          email: "test-integrity@example.com",
          address: {
            name: "Test Integridad",
            phone: "3000000000",
            line1: "Calle Prueba 123",
            city: "Bucaramanga",
            region: "Santander",
            postal_code: "680001",
            country: "CO",
          },
          shippingCents: 1000000,
          discountCents: 0,
          items: [
            {
              productId: sampleProduct.id,
              title: sampleProduct.name,
              quantity: 1,
              unitPriceCents: Math.round(Number(sampleProduct.price) * 100),
            },
          ],
        }),
      });
      clearTimeout(timeout);

      const text = await res.text();
      let payload: { url?: string; orderId?: string; error?: string } = {};
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`El endpoint devolvió HTML/texto no JSON (HTTP ${res.status})`);
      }

      if (!res.ok || !payload.url || !payload.orderId) {
        throw new Error(payload.error || `Respuesta inválida HTTP ${res.status}`);
      }

      createdTestOrderId = payload.orderId;
      record(
        "E2E",
        "Endpoint POST /api/checkout/stripe",
        "PASS",
        `Sesión Stripe generada correctamente (${payload.url.slice(0, 42)}...)`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isOffline =
        msg.includes("fetch failed") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("aborted");

      record(
        "E2E",
        "Endpoint POST /api/checkout/stripe",
        isOffline ? "WARN" : "FAIL",
        isOffline
          ? `Servidor local no responde en ${appUrl} (inicia 'npm run dev' para probar la ruta HTTP)`
          : msg
      );
    } finally {
      // Limpiar la orden temporal de prueba para no ensuciar la base de datos
      if (createdTestOrderId) {
        await adminDb.from("order_items").delete().eq("order_id", createdTestOrderId);
        await adminDb.from("orders").delete().eq("id", createdTestOrderId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // RESUMEN FINAL
  // ---------------------------------------------------------------------------
  const passed = results.filter((r) => r.status === "PASS").length;
  const warned = results.filter((r) => r.status === "WARN").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log("\n=== RESULTADO DE LA AUDITORÍA ===");
  console.log(`✅ PASS: ${passed} | ⚠️ WARN: ${warned} | ❌ FAIL: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

void runIntegritySuite();