import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  return <LoginForm expired={sp.expired === "1"} next={typeof sp.next === "string" ? sp.next : null} />;
}
