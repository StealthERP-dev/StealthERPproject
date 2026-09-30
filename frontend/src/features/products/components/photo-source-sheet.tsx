"use client";

// The camera-or-gallery sheet (D-01, net-new — UI-SPEC section 3). Content
// only: the shell (scrim, handle, close button) is BottomSheet's, reused
// unmodified per UI-SPEC's explicit instruction not to reimplement it.
//
// Two separate <input type="file"> rows, not one input with a toggle: on
// Android Chrome, the rear-camera hint on one input removes the gallery
// option from that same input entirely, so a single input is structurally
// incapable of offering both choices (RESEARCH.md Pattern 1). Each row is a
// label wrapping a visually-hidden input, so the whole row is the tap
// target.

import { Camera, Image as ImageIcon } from "lucide-react";
import type { ChangeEvent } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";

const rowClass =
  "flex h-14 items-center gap-3 rounded-2xl bg-muted px-4 transition-opacity active:opacity-70 cursor-pointer";

export function PhotoSourceSheet({
  onClose,
  onFileSelected,
}: {
  onClose: () => void;
  onFileSelected: (file: File) => void;
}) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    onClose();
    if (file) onFileSelected(file);
  }

  return (
    <BottomSheet label="Add photo" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <label className={rowClass}>
          <Camera className="h-5 w-5 text-foreground" />
          <span className="text-sm font-semibold text-foreground">
            Take photo
          </span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handleChange}
          />
        </label>
        <label className={rowClass}>
          <ImageIcon className="h-5 w-5 text-foreground" />
          <span className="text-sm font-semibold text-foreground">
            Choose from gallery
          </span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleChange}
          />
        </label>
      </div>
    </BottomSheet>
  );
}
