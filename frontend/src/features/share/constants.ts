export const SHARE_DESTINATIONS = [
  { label: "WhatsApp", emoji: "💬" },
  { label: "Status", emoji: "◉" },
  { label: "Instagram", emoji: "📸" },
  { label: "Other", emoji: "↗" },
] as const;

export type ShareDestinationLabel =
  (typeof SHARE_DESTINATIONS)[number]["label"];

// The fifth recorded destination (D-05, SHAR-01): Copy link is not one of
// the four buttons above (the shell renders those from SHARE_DESTINATIONS
// unchanged) but still writes its own catalogue_shares row, so the recorded
// destination column needs one literal wider than the four-button union.
export const COPY_LINK_DESTINATION = "Copy link";

export type RecordedShareDestination =
  ShareDestinationLabel | typeof COPY_LINK_DESTINATION;
