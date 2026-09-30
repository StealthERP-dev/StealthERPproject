// The /manage/[id]/edit route (PROD-07) — awaits its params the way Next 16
// requires, matching the shipped detail and public store routes. Renders
// the same container /manage/add uses, in update mode, seeded from the
// vendor's own shared product cache.

import { AddEditProductPage } from "@/features/products/components/add-edit-product-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AddEditProductPage mode="update" productId={id} />;
}
