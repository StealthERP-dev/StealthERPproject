"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function BackButton({ onBack }: { onBack?: () => void }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={
        onBack ??
        (() => {
          router.back();
        })
      }
      aria-label="Go back"
      className="group -m-2.5 flex-shrink-0 p-2.5"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted transition-transform group-active:scale-90">
        <ArrowLeft className="h-4 w-4 text-foreground" />
      </span>
    </button>
  );
}
