import type { Metadata } from "next";
import { StorefrontPage } from "@/features/storefront/components/storefront-page";
import { createServerReadClient } from "@/lib/supabase/server-read-client";

// The generic fallback for a slug that resolves to no shop — the same
// static title the root layout already declares, with no openGraph key at
// all, so a dead or forged link can never carry any real shop's identity
// (D-02's unknown-slug case).
const FALLBACK_METADATA: Metadata = { title: "Store" };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  try {
    const supabase = createServerReadClient();

    // Shop identity ALWAYS comes from public_stores, never an embed off
    // products — public.stores has no anon grant at all, and that is a
    // permission failure, not a null embed.
    const { data: store, error: storeError } = await supabase
      .from("public_stores")
      .select("id, shop_name")
      .eq("slug", slug)
      .maybeSingle();

    if (storeError) throw storeError;
    if (!store?.id || !store.shop_name) {
      return FALLBACK_METADATA;
    }

    // The first available product's photo, ordered by name — resolved to
    // the first one that actually has a photo (RESEARCH A1).
    const { data: photoProduct, error: productError } = await supabase
      .from("products")
      .select("image_url")
      .eq("store_id", store.id)
      .eq("available", true)
      .not("image_url", "is", null)
      .order("name")
      .limit(1)
      .maybeSingle();

    if (productError) throw productError;

    const title = store.shop_name;
    const description = `Available today at ${store.shop_name}`;
    const imageUrl = photoProduct?.image_url ?? null;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        // Product photo URLs in this project are already absolute — never a
        // relative path — so this never depends on a configured URL base.
        // Only included when a photo was actually found (Pattern 2, A1).
        ...(imageUrl ? { images: [imageUrl] } : {}),
      },
    };
  } catch (err) {
    // Next swallows a rejection from generateMetadata without printing
    // anything (Pitfall 2) — without this log, a wrong column name would
    // produce no visible symptom anywhere.
    console.error("generateMetadata failed for /store/[slug]:", err);
    return FALLBACK_METADATA;
  }
}

export default async function StoreSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <StorefrontPage slug={slug} />;
}
