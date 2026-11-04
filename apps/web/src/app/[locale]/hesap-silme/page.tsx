import Link from "next/link";
import { isLocale, localePath, type Locale } from "@/lib/i18n";
import { loadMessages } from "@/lib/messages";
import { pageMetadata } from "@/lib/page-meta";

// Public account-deletion page: Google Play asks for a web link that explains how to delete an account and its data.

export const generateMetadata = pageMetadata("deletion");

const SUPPORT = "support@casalume.app";

export default async function DeletionPage({ params }: PageProps<"/[locale]/hesap-silme">) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "tr";
  const t = (await loadMessages(locale)).deletion;
  const [before, after] = t.byMail.split("{email}");
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-light leading-tight">{t.title}</h1>
      <p className="mt-4 text-lg text-muted">{t.intro}</p>
      <ul className="mt-8 list-disc space-y-3 pl-6">
        <li>{t.inApp}</li>
        <li>{t.onWeb}</li>
        <li>
          {before}
          <a href={`mailto:${SUPPORT}`} className="text-primary underline underline-offset-2">
            {SUPPORT}
          </a>
          {after}
        </li>
      </ul>
      <p className="mt-6 rounded-2xl bg-surface px-4 py-3 text-sm">{t.subscription}</p>
      <h2 className="mt-10 text-lg font-medium">{t.whatTitle}</h2>
      <p className="mt-2 text-muted">{t.what}</p>
      <h2 className="mt-8 text-lg font-medium">{t.keepTitle}</h2>
      <p className="mt-2 text-muted">{t.keep}</p>
      <Link href={localePath(locale, "/hesap")} className="mt-10 inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-white hover:bg-primary-strong">
        {t.cta}
      </Link>
    </div>
  );
}
