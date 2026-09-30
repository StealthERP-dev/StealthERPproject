"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function BottomSheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 mx-auto flex max-w-[390px] flex-col justify-end"
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <div className="relative flex max-h-[93%] flex-col overflow-hidden rounded-t-3xl bg-background">
        <div className="relative flex flex-shrink-0 items-center justify-center px-5 pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-foreground/15" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="group absolute top-1.5 right-4 -m-2.5 p-2.5"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted transition-transform group-active:scale-90">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pt-2 pb-8">{children}</div>
      </div>
    </div>
  );
}
