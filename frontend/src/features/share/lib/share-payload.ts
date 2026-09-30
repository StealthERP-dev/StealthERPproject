// Pure, dependency-free URL/payload builders for the share sheets (SHAR-01,
// SHAR-02, SHAR-03). No imports from the app at all — importable directly by
// `node --test`, the same discipline greeting.ts's own unit test already
// establishes. Every function here is a plain string transform; the
// browser-facing dispatch (window.open/navigator.share/clipboard) lives in
// use-share-destination.ts, never here — this split is what makes the URL
// and payload shapes independently testable from the dispatch mechanics.

/** Strips exactly one trailing slash from an origin so a built URL never
 * contains a double slash, regardless of whether the caller's origin (e.g.
 * from window.location.origin) already ends with one. */
function normaliseOrigin(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}

export function buildStorefrontUrl(origin: string, slug: string): string {
  return `${normaliseOrigin(origin)}/store/${slug}`;
}

export function buildProductUrl(
  origin: string,
  slug: string,
  productId: string,
): string {
  return `${normaliseOrigin(origin)}/store/${slug}/p/${productId}`;
}

export interface SharePayload {
  title: string;
  text: string;
  url: string;
}

/** The same sentence SHAR-05's link-preview metadata uses ("Available today
 * at <shop name>") — reused rather than reinvented, so a shared link and its
 * own metadata preview say the same thing. */
function buildShareText(shopName: string): string {
  return `Available today at ${shopName}`;
}

/** Builds the share payload for either a catalogue or a single product —
 * `product` present selects the product shape. The title for a catalogue is
 * the shop name; for a product it is the product name, a space, a middle
 * dot, a space, then the shop name (SHAR-02's product-card title, minus the
 * prototype's "Fresh " prefix per UI-SPEC's Copywriting Contract). */
export function buildSharePayload({
  origin,
  slug,
  shopName,
  product,
}: {
  origin: string;
  slug: string;
  shopName: string;
  product?: { id: string; name: string };
}): SharePayload {
  if (product) {
    return {
      title: `${product.name} · ${shopName}`,
      text: buildShareText(shopName),
      url: buildProductUrl(origin, slug, product.id),
    };
  }
  return {
    title: shopName,
    text: buildShareText(shopName),
    url: buildStorefrontUrl(origin, slug),
  };
}

/** `wa.me/?text=` with no phone segment — opens WhatsApp's own contact/chat
 * picker pre-filled with the message (D-05's "genuinely targetable"
 * destination). The whole message (title, a newline, then the URL) is
 * encoded as a single component; WhatsApp auto-links the URL inside the
 * decoded text on its own, so the URL is never separately re-encoded. */
export function buildWhatsAppUrl(payload: SharePayload): string {
  const message = `${payload.title}\n${payload.url}`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
