import { Suspense } from "react";
import { LoginPage } from "@/features/auth/components/login-page";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <LoginPage />
    </Suspense>
  );
}
