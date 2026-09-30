import type { Metadata } from "next";
import { StorefrontProductPage } from "@/features/storefront/components/product-detail-page";
import { createServerReadClient } from "@/lib/supabase/server-read-client";

// Same generic fallback the catalogue route uses — this link claims to be a
// product link, so an unresolved slug or product id must never carry any
// real shop's or product's identity (D-02).
const FALLBACK_METADATA: Metadata = { title: "Store" };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}): Promise<Metadata> {
  const { slug, id } = await params;

  try {
    const supabase = createServerReadClient();

    // Shop identity ALWAYS comes from public_stores, never an embed off
    // products — public.stores has no anon grant at all.
    const { data: store, error: storeError } = await supabase
      .from("public_stores")
      .select("id, shop_name")
      .eq("slug", slug)
      .maybeSingle();

    if (storeError) throw storeError;
    if (!store?.id || !store.shop_name) {
      return FALLBACK_METADATA;
    }

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("name, image_url")
      .eq("store_id", store.id)
      .eq("id", id)
      .eq("available", true)
      .maybeSingle();

    if (productError) throw productError;
    if (!product?.name) {
      // A well-formed but unresolvable product id under a valid shop still
      // gets the generic fallback, never the shop's own catalogue metadata
      // — answering a product link with shop-level tags would misrepresent
      // what the recipient is about to open.
      return FALLBACK_METADATA;
    }

    const title = `${product.name} · ${store.shop_name}`;
    const description = `Available today at ${store.shop_name}`;
    const imageUrl = product.image_url ?? null;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        ...(imageUrl ? { images: [imageUrl] } : {}),
      },
    };
  } catch (err) {
    // Next swallows a rejection from generateMetadata without printing
    // anything — without this log a genuine bug would produce no visible
    // symptom anywhere.
    console.error("generateMetadata failed for /store/[slug]/p/[id]:", err);
    return FALLBACK_METADATA;
  }
}

export default async function StoreProductPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  return <StorefrontProductPage slug={slug} id={id} />;
}
