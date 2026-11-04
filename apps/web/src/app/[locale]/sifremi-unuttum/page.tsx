import { pageMetadata } from "@/lib/page-meta";
import { ForgotForm } from "./forgot-form";

export const generateMetadata = pageMetadata("forgotPassword");

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
