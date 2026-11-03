import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AppProvider } from "@/components/app-provider";
import { SiteFooter } from "@/components/site-footer";
import { HeaderFallback, SiteHeader } from "@/components/site-header";
import { VerifyBanner } from "@/components/verify-banner";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "AI Room — Odanı saniyeler içinde yeniden tasarla",
    template: "%s · AI Room",
  },
  description:
    "Yapay zekâ ile iç mekân, dış cephe ve bahçe tasarımı. Türk ve Anadolu stilleri, TL bütçe tahmini ve Türk mağazalarından alışveriş listesi.",
  applicationName: "AI Room",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1311" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr" className={`${jakarta.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AppProvider>
          <Suspense fallback={<HeaderFallback />}>
            <SiteHeader />
          </Suspense>
          <VerifyBanner />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </AppProvider>
      </body>
    </html>
  );
}
