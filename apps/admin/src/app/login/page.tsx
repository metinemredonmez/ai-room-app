import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  // No code field when the backend skips it for this panel: ADMIN_DEV_SKIP_MFA on a developer machine, or
  // ADMIN_PANEL_KEY (owner decision; the panel is reachable only from allow-listed addresses).
  const devSkip = process.env.NODE_ENV === "development" && process.env.ADMIN_DEV_SKIP_MFA === "true";
  const mfa = !devSkip && !process.env.ADMIN_PANEL_KEY;
  return <LoginForm expired={sp.expired === "1"} next={typeof sp.next === "string" ? sp.next : null} mfa={mfa} />;
}
