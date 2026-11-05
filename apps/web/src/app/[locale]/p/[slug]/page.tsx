import type { Metadata } from "next";
import { ClientOnly } from "@/components/client-only";
import { PartnerRedirect } from "./partner-redirect";

// API.md §7.33: a partner's short link. Counts the visit, remembers the partner on this device, then shows the home page.
// Rendered on the client (the slug comes from useParams), so nothing here is prerendered per partner.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function PartnerPage() {
  return (
    <ClientOnly fallback={null}>
      <PartnerRedirect />
    </ClientOnly>
  );
}
