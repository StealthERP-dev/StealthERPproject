// The /manage/add route (D-13: a real Next.js route, not a DOM overlay).
// Thin wrapper, matching the shape of the shipped setup/login routes — no
// Suspense needed here (unlike /manage), since AddEditProductPage reads no
// search params.

import { AddEditProductPage } from "@/features/products/components/add-edit-product-page";

export default function Page() {
  return <AddEditProductPage />;
}
