import { pageMetadata } from "@/lib/page-meta";
import { ClientOnly, PageSkeleton } from "@/components/client-only";
import { TeamView } from "./team-view";

// API.md §7.23 step 3: a firm's team, run by its owner and admins.
export const generateMetadata = pageMetadata("team", { robots: { index: false, follow: false } });

export default function TeamPage() {
  return (
    <ClientOnly fallback={<PageSkeleton />}>
      <TeamView />
    </ClientOnly>
  );
}
