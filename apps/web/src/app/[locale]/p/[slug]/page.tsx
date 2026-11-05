import type { Metadata } from "next";
import { PartnerRedirect } from "./partner-redirect";

// API.md §7.33: a partner's short link. Counts the visit, remembers the partner on this device, then shows the home page.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PartnerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PartnerRedirect slug={slug.toLowerCase()} />;
}
