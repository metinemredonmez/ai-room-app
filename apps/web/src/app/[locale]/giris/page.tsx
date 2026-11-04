import { pageMetadata } from "@/lib/page-meta";
import { AuthForm } from "./auth-form";

export const generateMetadata = pageMetadata("login");

export default function LoginPage() {
  return <AuthForm />;
}
