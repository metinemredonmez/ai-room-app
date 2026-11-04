import { pageMetadata } from "@/lib/page-meta";
import { ClientOnly, PageSkeleton } from "@/components/client-only";
import { DesignDetail } from "./design-detail";

export const generateMetadata = pageMetadata("design");

export default function DesignPage() {
  return (
    <ClientOnly fallback={<PageSkeleton />}>
      <DesignDetail />
    </ClientOnly>
  );
}
