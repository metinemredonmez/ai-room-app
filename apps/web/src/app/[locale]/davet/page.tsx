import { pageMetadata } from "@/lib/page-meta";
import { InviteView } from "./invite-view";

// API.md §7.23: a firm's e-mail invitation (#token=… in the fragment, never sent to a server log).
export const generateMetadata = pageMetadata("invite", { referrer: "no-referrer", robots: { index: false, follow: false } });

export default function InvitePage() {
  return <InviteView />;
}
