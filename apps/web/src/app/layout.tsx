import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Cormorant_Garamond, Plus_Jakarta_Sans } from "next/font/google";
import { AppProvider } from "@/components/app-provider";
import { SiteFooter } from "@/components/site-footer";
import { HeaderFallback, SiteHeader } from "@/components/site-header";
import { VerifyBanner } from "@/components/verify-banner";
import { PALETTE_BOOT_SCRIPT } from "@/lib/palette";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500"],
  display: "swap",
});

// Thin serif for headings and the wordmark (owner: minimal, not bold).
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Casalume — Odanı saniyeler içinde yeniden tasarla",
    template: "%s · Casalume",
  },
  description:
    "Yapay zekâ ile iç mekân, dış cephe ve bahçe tasarımı. Türk ve Anadolu stilleri, TL bütçe tahmini ve Türk mağazalarından alışveriş listesi.",
  applicationName: "Casalume",
};

export const viewport: Viewport = {
  themeColor: "#f6f1ea",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The boot script may set data-palette before React hydrates, hence suppressHydrationWarning on <html> only.
    <html lang="tr" className={`${jakarta.variable} ${cormorant.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PALETTE_BOOT_SCRIPT }} />
      </head>
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
