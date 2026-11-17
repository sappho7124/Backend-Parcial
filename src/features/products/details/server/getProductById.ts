import type { Product } from "@/src/features/products/domain/Product";
import { getSupabaseServerClient } from "@/src/lib/supabase/server";

type DbProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  weight_kg: number | string;
  stock: number;
};

export async function getProductById(productId: string): Promise<Product | null> {
  if (!productId || typeof productId !== "string") return null;

  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("products")
    .select("id, name, description, price, weight_kg, stock")
    .eq("id", productId)
    .maybeSingle();

  if (error || !data) {
    // eslint-disable-next-line no-console
    if (error) console.error("[getProductById]", error);
    return null;
  }

  const p = data as unknown as DbProductRow;
  const numericPrice = Number(p.price) || 0;
  const priceInCents = Math.round(numericPrice * 100);

  return {
    id: p.id as unknown as Product["id"],
    name: p.name,
    price: priceInCents,
    originalPrice: undefined,
    image: "/placeholder.svg",
    images: [],
    category: "General",
    subcategory: "Tops",
    badge: undefined,
    colors: [],
    availableSizes: [],
    allCategories: ["General"],
    allSubcategories: ["Tops"],
  };
}