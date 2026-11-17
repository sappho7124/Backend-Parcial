import type { Metadata } from "next";
import { ProductDetailPage } from "@/src/features/products/details";
import { buildStorefrontMetadata } from "@/src/lib/seo";

type ProductPageProps = {
  params: Promise<{ id: string }>;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { id } = await params;
  return buildStorefrontMetadata({
    title: "Detalle de Repuesto",
    description: "Consulta especificaciones, peso logístico y disponibilidad.",
    path: `/products/${id}`,
  });
}

export default async function Page({ params }: ProductPageProps) {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    return <div className="px-6 py-24">ID de producto inválido (se requiere UUID).</div>;
  }

  return <ProductDetailPage productId={id} />;
}