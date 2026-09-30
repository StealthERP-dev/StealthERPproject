"use client";

// Category-filter bottom sheet (PROD-01). Content only — the scrim, handle
// and close button are BottomSheet's, unchanged and reused. Ports
// App.tsx:1281-1293's chip list, bumped to the 44px touch-target floor.

import { Check } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";

export function CategoryFilterSheet({
  categoryList,
  categoryFilter,
  onSelect,
  onClose,
}: {
  categoryList: string[];
  categoryFilter: string;
  onSelect: (category: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet label="Filter by category" onClose={onClose}>
      <p className="pb-3 text-[15px] font-semibold text-foreground">
        Filter by category
      </p>
      <div className="flex flex-wrap gap-2">
        {categoryList.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => {
              onSelect(category);
            }}
            className={`flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-colors active:scale-95 ${
              categoryFilter === category
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {categoryFilter === category && (
              <Check className="h-3 w-3 flex-shrink-0" />
            )}
            {category === "All" ? "All categories" : category}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
