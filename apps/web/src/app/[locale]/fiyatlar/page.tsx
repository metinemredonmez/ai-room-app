import { pageMetadata } from "@/lib/page-meta";
import { waitlistStatus } from "@/lib/waitlist";
import { Pricing } from "./pricing";

export const generateMetadata = pageMetadata("pricing");

// Plans, web prices and packs come with the catalog (API.md §7.50); the store links and the waiting list from §7.47.
export default async function PricingPage() {
  return <Pricing waitlist={await waitlistStatus()} />;
}
