"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  SHARE_DESTINATIONS,
  type ShareDestinationLabel,
} from "@/features/share/constants";

export function ShareSheet({
  label,
  preview,
  onClose,
  onSelectDestination,
  onCopyLink,
  copyLinkLabel = "Copy link",
  footer,
}: {
  label: string;
  preview: ReactNode;
  onClose: () => void;
  onSelectDestination: (destination: ShareDestinationLabel) => void;
  onCopyLink: () => void | Promise<void>;
  /** Idle-state copy-button text; defaults to what it already said so no
   * existing caller's rendered text changes. The post-copy confirmation
   * stays the shell's own two-second wording for every caller regardless
   * of this prop. */
  copyLinkLabel?: string;
  footer?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const handleCopy = () => {
    void (async () => {
      await onCopyLink();
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    })();
  };

  return (
    <BottomSheet label={label} onClose={onClose}>
      {preview}
      <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        Share via
      </p>
      <div className="mb-4 grid grid-cols-4 gap-2.5">
        {SHARE_DESTINATIONS.map((destination) => (
          <button
            key={destination.label}
            type="button"
            onClick={() => {
              onSelectDestination(destination.label);
            }}
            className="flex flex-col items-center gap-2 rounded-xl bg-muted py-3.5 transition-transform active:scale-95"
          >
            <span className="text-[22px] leading-none">
              {destination.emoji}
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">
              {destination.label}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-all active:scale-[0.98]"
      >
        {copied ? (
          <Check className="h-4 w-4 text-[#16A34A]" />
        ) : (
          <Copy className="h-4 w-4 text-muted-foreground" />
        )}
        {copied ? "Link copied!" : copyLinkLabel}
      </button>
      {footer}
    </BottomSheet>
  );
}
