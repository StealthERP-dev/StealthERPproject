"use client";

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
}) {
  // The hit area is padded VERTICALLY only, deliberately. The switch itself is
  // already `w-11` = 44px wide, so it needs padding to reach 44px of HEIGHT
  // (24 + 10 + 10) and none at all for width.
  //
  // This was `-m-2.5 p-2.5`, which also pushed the hit area 10px past each
  // horizontal edge. Measured at the 390px design width, that made a product
  // row's toggle pad (253→317) overlap the Share button's (311→367) by 6px
  // inside their 14px `gap-3.5` — a tap in that band went to whichever button
  // came later in the DOM. Every arithmetic check had passed, because each
  // control clears 44px on its own; only the rendered geometry showed the two
  // pads intersecting. If you restore horizontal padding here, re-measure the
  // product row.
  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      aria-label={label ?? (checked ? "Turn off" : "Turn on")}
      className="-my-2.5 flex-shrink-0 py-2.5"
    >
      <span
        className={`relative block h-6 w-11 rounded-full transition-colors duration-200 ${
          checked ? "bg-[#16A34A]" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}
