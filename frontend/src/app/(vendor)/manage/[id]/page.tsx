// The /manage/[id] route (PROD-06) — awaits its params, since Next 16
// removed the synchronous params-access shim. Thin wrapper, matching the
// shipped public store route's async-params shape.

import { ProductDetailPage } from "@/features/products/components/product-detail-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductDetailPage id={id} />;
}
