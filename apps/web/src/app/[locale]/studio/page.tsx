import { pageMetadata } from "@/lib/page-meta";
import { ClientOnly, PageSkeleton } from "@/components/client-only";
import { Studio } from "./studio";

export const generateMetadata = pageMetadata("studio");

export default function StudioPage() {
  return (
    <ClientOnly fallback={<PageSkeleton />}>
      <Studio />
    </ClientOnly>
  );
}
