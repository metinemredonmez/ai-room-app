import { pageMetadata } from "@/lib/page-meta";
import { LeaveView } from "./leave-view";

// The link carries a signed entry id: keep it out of referrers and search engines.
export const generateMetadata = pageMetadata("waitlistLeave", { referrer: "no-referrer", robots: { index: false, follow: false } });

export default function WaitlistLeavePage() {
  return <LeaveView />;
}
