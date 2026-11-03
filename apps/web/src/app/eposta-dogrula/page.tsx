import type { Metadata } from "next";
import { VerifyView } from "./verify-view";

export const metadata: Metadata = { title: "E-posta doğrulama", referrer: "no-referrer" };

export default function VerifyEmailPage() {
  return <VerifyView />;
}
