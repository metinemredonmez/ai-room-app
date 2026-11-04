import { pageMetadata } from "@/lib/page-meta";
import { ResetForm } from "./reset-form";

export const generateMetadata = pageMetadata("resetPassword", { referrer: "no-referrer" });

export default function ResetPasswordPage() {
  return <ResetForm />;
}
