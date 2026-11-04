import { pageMetadata } from "@/lib/page-meta";
import { ClientOnly, PageSkeleton } from "@/components/client-only";
import { DesignsList } from "./designs-list";

export const generateMetadata = pageMetadata("designs");

export default function DesignsPage() {
  return (
    <ClientOnly fallback={<PageSkeleton />}>
      <DesignsList />
    </ClientOnly>
  );
}
