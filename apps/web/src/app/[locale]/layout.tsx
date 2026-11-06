import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Cormorant_Garamond, Plus_Jakarta_Sans } from "next/font/google";
import { AppProvider } from "@/components/app-provider";
import { ErrorReporter } from "@/components/error-reporter";
import { SiteFooter } from "@/components/site-footer";
import { ThemeOptionsProvider } from "@/components/palette-picker";
import { HeaderFallback, SiteHeader } from "@/components/site-header";
import { VerifyBanner } from "@/components/verify-banner";
import { LOCALES, LOCALE_TAGS, isLocale } from "@/lib/i18n";
import { loadMessages } from "@/lib/messages";
import { PALETTE_BOOT_SCRIPT } from "@/lib/palette";
import { getTheme, themeCss, themeOptions } from "@/lib/theme";
import "../globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500"],
  display: "swap",
});

// Thin serif for headings and the wordmark (owner: minimal, not bold). Cyrillic for Russian headings; Japanese,
// Korean and Chinese fall back to the system fonts.
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["300", "400", "500"],
  display: "swap",
});

// Every language is pre-rendered. The proxy maps unprefixed paths onto /tr internally, so an unknown first segment
// lands under /tr and gets the localised 404; isLocale() below guards direct hits (dynamicParams is not allowed with
// cacheComponents).
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await loadMessages(locale);
  return {
    title: { default: `Casalume — ${t.brandTagline}`, template: "%s · Casalume" },
    description: t.meta.description,
    applicationName: "Casalume",
  };
}

export const viewport: Viewport = {
  themeColor: "#f6f1ea",
};

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [messages, theme] = await Promise.all([loadMessages(locale), getTheme()]);
  return (
    // The boot script may set data-palette before React hydrates, hence suppressHydrationWarning on <html> only.
    <html lang={LOCALE_TAGS[locale]} className={`${jakarta.variable} ${cormorant.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PALETTE_BOOT_SCRIPT }} />
        {/* Colour themes from the admin (API.md §7.34); every value is checked to be #rrggbb in lib/theme.ts. */}
        {theme && <style dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />}
      </head>
      <body className="flex min-h-full flex-col">
        <AppProvider locale={locale} messages={messages}>
          <ErrorReporter />
          <ThemeOptionsProvider options={theme ? themeOptions(theme) : null}>
            <Suspense fallback={<HeaderFallback />}>
              <SiteHeader />
            </Suspense>
          </ThemeOptionsProvider>
          <VerifyBanner />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </AppProvider>
      </body>
    </html>
  );
}
