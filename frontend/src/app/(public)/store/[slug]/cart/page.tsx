import { CartPage } from "@/features/storefront/components/cart-page";

// Thin async server wrapper, copying the product route's shape
// (.../p/[id]/page.tsx) minus generateMetadata entirely — a cart has no
// shareable identity to put in link tags and this route is never itself
// shared (STOR-05, D-02).
export default async function StoreCartPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <CartPage slug={slug} />;
}
