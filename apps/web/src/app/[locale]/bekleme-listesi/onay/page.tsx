import { pageMetadata } from "@/lib/page-meta";
import { ConfirmView } from "./confirm-view";

// The link carries a single-use token in its fragment: keep the page out of referrers and search engines.
export const generateMetadata = pageMetadata("waitlistConfirm", { referrer: "no-referrer", robots: { index: false, follow: false } });

export default function WaitlistConfirmPage() {
  return <ConfirmView />;
}
