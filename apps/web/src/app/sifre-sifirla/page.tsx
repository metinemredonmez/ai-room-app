import type { Metadata } from "next";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Yeni şifre", referrer: "no-referrer" };

export default function ResetPasswordPage() {
  return <ResetForm />;
}
