// The /offers/add route (D-13: a real Next.js route, not a DOM overlay).
// Thin wrapper, matching the shape of the shipped /manage/add route — no
// Suspense needed here, since AddOfferPage reads no search params.

import { AddOfferPage } from "@/features/offers/components/add-offer-page";

export default function Page() {
  return <AddOfferPage />;
}
