"use client";

import { useIsClient } from "./app-provider";

/** Renders children only after hydration (for screens built from browser-only state). */
export function ClientOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return useIsClient() ? <>{children}</> : <>{fallback}</>;
}

export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="h-9 w-64 animate-pulse rounded-full bg-surface-2" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[5fr_7fr]">
        <div className="h-96 animate-pulse rounded-3xl bg-surface-2" />
        <div className="h-96 animate-pulse rounded-3xl bg-surface-2" />
      </div>
    </div>
  );
}
