import type { Metadata } from "next";
import { Landing } from "@/components/landing";
import { seoPages } from "@/lib/content";
import { isLocale } from "@/lib/i18n";

// Home: an approved SEO text (API.md §7.18) replaces the layout's default title and description.
export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const home = (await seoPages(isLocale(locale) ? locale : "tr")).home;
  return home ? { title: { absolute: home.title }, description: home.description } : {};
}

export default function Home() {
  return <Landing />;
}
