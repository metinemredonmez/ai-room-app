import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  // Mirrors the backend's ADMIN_DEV_SKIP_MFA (development only): no code field on a developer machine.
  const mfa = !(process.env.NODE_ENV === "development" && process.env.ADMIN_DEV_SKIP_MFA === "true");
  return <LoginForm expired={sp.expired === "1"} next={typeof sp.next === "string" ? sp.next : null} mfa={mfa} />;
}
