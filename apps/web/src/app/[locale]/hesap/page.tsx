import { pageMetadata } from "@/lib/page-meta";
import { ClientOnly, PageSkeleton } from "@/components/client-only";
import { AccountView } from "./account-view";

export const generateMetadata = pageMetadata("profile", { robots: { index: false, follow: false } });

export default function AccountPage() {
  return (
    <ClientOnly fallback={<PageSkeleton />}>
      <AccountView />
    </ClientOnly>
  );
}
