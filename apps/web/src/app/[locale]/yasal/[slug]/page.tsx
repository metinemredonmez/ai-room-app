import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { legalDoc } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { fmt, isLocale, localePath, type Locale } from "@/lib/i18n";
import { LEGAL_PAGES, LEGAL_SLUGS, isLegalSlug } from "@/lib/legal";
import { loadMessages } from "@/lib/messages";

// Legal texts (KVKK): published by the admin, served by the API in Turkish or English and cached for a few minutes.

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/yasal/[slug]">): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : "tr";
  if (!isLegalSlug(slug)) return {};
  const t = await loadMessages(locale);
  return { title: t.legal.names[slug] };
}

export default async function LegalPage({ params }: PageProps<"/[locale]/yasal/[slug]">) {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : "tr";
  if (!isLegalSlug(slug)) notFound();
  const [t, doc] = await Promise.all([loadMessages(locale), legalDoc(LEGAL_PAGES[slug], locale)]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-light leading-tight">{doc?.title ?? t.legal.names[slug]}</h1>
      {doc ? (
        <>
          <p className="mt-3 text-sm text-muted">
            {fmt(t.legal.version, { v: doc.version })} · {formatDate(doc.publishedAt, locale)}
          </p>
          {doc.locale !== locale && locale !== "tr" && <p className="mt-6 rounded-2xl bg-surface px-4 py-3 text-sm text-muted">{t.legal.englishOnly}</p>}
          <div className="mt-6">
            <Markdown source={doc.body} locale={locale} />
          </div>
        </>
      ) : (
        <p className="mt-8 text-muted">{t.legal.unavailable}</p>
      )}
      <nav className="mt-14 border-t border-border pt-6 text-sm" aria-label={t.legal.others}>
        <p className="font-medium">{t.legal.others}</p>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {LEGAL_SLUGS.filter((s) => s !== slug).map((s) => (
            <li key={s}>
              <Link href={localePath(locale, `/yasal/${s}`)} className="text-muted hover:text-text">
                {t.legal.names[s]}
              </Link>
            </li>
          ))}
          <li>
            <Link href={localePath(locale, "/hesap-silme")} className="text-muted hover:text-text">
              {t.footer.deleteAccount}
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
