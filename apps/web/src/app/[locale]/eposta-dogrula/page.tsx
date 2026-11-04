import { pageMetadata } from "@/lib/page-meta";
import { VerifyView } from "./verify-view";

export const generateMetadata = pageMetadata("verifyEmail", { referrer: "no-referrer" });

export default function VerifyEmailPage() {
  return <VerifyView />;
}
