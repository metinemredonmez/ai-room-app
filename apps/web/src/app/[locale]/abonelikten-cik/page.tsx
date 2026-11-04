import { pageMetadata } from "@/lib/page-meta";
import { UnsubscribeView } from "./unsubscribe-view";

// The link carries a signed delivery id: keep it out of referrers and search engines.
export const generateMetadata = pageMetadata("unsubscribe", { referrer: "no-referrer", robots: { index: false, follow: false } });

export default function UnsubscribePage() {
  return <UnsubscribeView />;
}
