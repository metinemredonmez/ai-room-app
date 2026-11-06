import type { Metadata } from "next";
import { Landing } from "@/components/landing";
import { seoPages } from "@/lib/content";
import { isLocale } from "@/lib/i18n";
import { siteContent } from "@/lib/site-content";
import { waitlistStatus } from "@/lib/waitlist";

// Home: an approved SEO text (API.md §7.18) replaces the layout's default title and description.
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const home = (await seoPages(isLocale(locale) ? locale : "tr")).home;
  return home ? { title: { absolute: home.title }, description: home.description } : {};
}

// Texts, FAQ and visible sections from the admin (API.md §7.46) and the waiting list (§7.47); the built-in content
// when the API is unreachable.
export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  const [content, waitlist] = await Promise.all([siteContent(isLocale(locale) ? locale : "tr"), waitlistStatus()]);
  return <Landing content={content} waitlist={waitlist} />;
}
