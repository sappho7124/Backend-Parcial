import type { Product } from "../domain/Product";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

type DbProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  weight_kg: number | string;
  stock: number;
};

function toDisplaySubcategory(
  nombre: string,
  categoria: string,
): Product["subcategory"] {
  const n = nombre.toLowerCase();

  if (n.includes("vestido")) return "Vestidos";
  if (n.includes("falda")) return "Bottoms";
  if (
    n.includes("pantal") ||
    n.includes("jeans") ||
    n.includes("jogger") ||
    n.includes("bermuda") ||
    n.includes("short")
  ) {
    return "Bottoms";
  }
  if (
    n.includes("chaqueta") ||
    n.includes("abrigo") ||
    n.includes("gabardina") ||
    n.includes("trench") ||
    n.includes("chaleco")
  ) {
    return "Outerwear";
  }
  if (
    n.includes("camisa") ||
    n.includes("camiseta") ||
    n.includes("blusa") ||
    n.includes("top") ||
    n.includes("hoodie") ||
    n.includes("sudadera") ||
    n.includes("jersey") ||
    n.includes("polo")
  ) {
    return "Tops";
  }

  if (categoria === "Accesorios") return "Bolsos";
  return "Tops";
}

function logServer(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[getProducts]", ...args);
}

function logServerError(...args: unknown[]) {
  const formatted = args.map((arg) =>
    arg instanceof Error
      ? { message: arg.message, cause: arg.cause }
      : typeof arg === "object" && arg !== null
      ? JSON.parse(JSON.stringify(arg, Object.getOwnPropertyNames(arg)))
      : arg
  );
  // eslint-disable-next-line no-console
  console.error("[getProducts]", ...formatted);
}

function normalizeDbProduct(p: DbProductRow): Product | null {
  if (!p.id || !p.name) return null;

  const numericPrice = Number(p.price) || 0;
  // formatCOP divide entre 100 al renderizar; multiplicamos por 100 porque tu columna price está en pesos/decimales
  const priceInCents = Math.round(numericPrice * 100);

  const primaryCategory = "General";
  const primarySubcategory = toDisplaySubcategory(p.name, primaryCategory) ?? "Tops";

  return {
    id: p.id as unknown as Product["id"],
    name: p.name,
    price: priceInCents,
    originalPrice: undefined,
    image: "/placeholder.svg",
    images: [],
    category: primaryCategory,
    subcategory: primarySubcategory,
    badge: undefined,
    colors: [],
    availableSizes: [],
    allCategories: [primaryCategory],
    allSubcategories: [primarySubcategory],
  };
}

export async function getProducts(limit?: number, offset?: number): Promise<Product[]> {
  return getProductsInternal({ requireSupabase: true, limit, offset });
}

export async function getProductsInternal(options?: {
  requireSupabase?: boolean;
  limit?: number;
  offset?: number;
}): Promise<Product[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error(
      "Supabase no está configurado en el servidor. Agrega NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en el entorno.",
    );
  }

  try {
    logServer("starting", {
      hasUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL),
    });

    const q = supabase
      .from("products")
      .select("id, name, description, price, weight_kg, stock")
      .order("name", { ascending: true });

    let dataResult;
    if (typeof options?.limit === "number") {
      const off = typeof options?.offset === "number" ? options.offset : 0;
      const from = off;
      const to = off + Math.max(0, options.limit - 1);
      dataResult = await q.range(from, to);
    } else {
      dataResult = await q.limit(200);
    }

    const { data, error } = dataResult;

    if (error) throw error;
    const rows = (data ?? []) as unknown as DbProductRow[];
    logServer("rows", rows.length);

    return rows
      .map((row) => normalizeDbProduct(row))
      .filter((p): p is Product => Boolean(p));
  } catch (e) {
    logServerError("failed primary query", e);
    throw e;
  }
}