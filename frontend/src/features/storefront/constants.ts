// place_order error codes and their customer-facing messages (D-03). Copied
// verbatim from the checkout copy in the prototype; Phase 6 may refine this.

export const PLACE_ORDER_ERROR_CODES = [
  "store_not_found",
  "store_closed",
  "rate_limited",
  "item_unavailable",
  "invalid_name",
  "invalid_phone",
  "invalid_note",
  "invalid_items",
  "invalid_qty",
] as const;

export type PlaceOrderErrorCode = (typeof PLACE_ORDER_ERROR_CODES)[number];

export const ORDER_ERROR_MESSAGES: Record<PlaceOrderErrorCode, string> = {
  store_not_found: "This shop link isn't available.",
  store_closed: "Store is closed · Orders paused",
  rate_limited:
    "Too many orders from this number in the last hour. Please try again later.",
  item_unavailable:
    "Some items in your cart just became unavailable. Please review your cart and try again.",
  invalid_name: "Please enter your name (at least 2 characters).",
  invalid_phone: "Please enter a valid mobile number.",
  invalid_note: "Your note is too long — please shorten it.",
  invalid_items: "Please check your order and try again.",
  invalid_qty: "Please check your order and try again.",
};

export const GENERIC_ORDER_ERROR =
  "Couldn't send your order request. Please try again.";
