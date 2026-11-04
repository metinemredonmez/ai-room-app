import { pageMetadata } from "@/lib/page-meta";
import { Pricing } from "./pricing";

export const generateMetadata = pageMetadata("pricing");

export default function PricingPage() {
  return <Pricing />;
}
