// The /offers route (D-13: a real Next.js route, not a DOM overlay). Thin
// wrapper, matching the shape of the shipped /manage/add route — no
// Suspense needed here, since ManageOffersPage reads no search params
// (unlike /manage, which needs Suspense only for its own status filter).

import { ManageOffersPage } from "@/features/offers/components/manage-offers-page";

export default function Page() {
  return <ManageOffersPage />;
}
