import { Suspense } from "react";
import { pageMetadata } from "@/lib/page-meta";
import { ClientOnly, PageSkeleton } from "@/components/client-only";
import { SupportView } from "./support-view";

export const generateMetadata = pageMetadata("support", { robots: { index: false, follow: false } });

export default function SupportPage() {
  return (
    <ClientOnly fallback={<PageSkeleton />}>
      <Suspense fallback={<PageSkeleton />}>
        <SupportView />
      </Suspense>
    </ClientOnly>
  );
}
