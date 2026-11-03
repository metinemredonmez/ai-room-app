import type { Metadata } from "next";
import { headers } from "next/headers";
import { FeedbackProvider } from "@/components/feedback";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AI Room Admin", template: "%s · AI Room Admin" },
  description: "AI Room yönetim paneli",
  robots: { index: false, follow: false, nocache: true },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Reading the request headers keeps every page request-time rendered, so Next.js can stamp
  // the per-request CSP nonce set in src/proxy.ts onto its scripts.
  await headers();
  return (
    <html lang="tr" className="h-full antialiased">
      <body className="min-h-full font-sans">
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}
