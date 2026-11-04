import Link from "next/link";
import { Suspense } from "react";
import { blogList } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { isLocale, localePath, type Locale } from "@/lib/i18n";
import { loadMessages } from "@/lib/messages";
import { pageMetadata } from "@/lib/page-meta";

export const generateMetadata = pageMetadata("blog");

export default function BlogPage({ params }: PageProps<"/[locale]/blog">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl px-4 py-16 sm:px-6" />}>
      <BlogList params={params} />
    </Suspense>
  );
}

async function BlogList({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : "tr";
  const [t, posts] = await Promise.all([loadMessages(locale), blogList(locale)]);
  return (
    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-4xl font-light sm:text-5xl">{t.blog.title}</h1>
      <p className="mt-3 max-w-2xl text-muted">{t.blog.subtitle}</p>
      {posts.length === 0 ? (
        <p className="mt-12 text-muted">{t.blog.empty}</p>
      ) : (
        <ul className="mt-10 grid gap-8 sm:grid-cols-2">
          {posts.map((p) => (
            <li key={p.id}>
              <Link href={localePath(locale, `/blog/${p.slug}`)} className="group block overflow-hidden rounded-2xl border border-border bg-surface transition hover:shadow-md">
                {p.coverUrl && (
                  <img src={p.coverUrl} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" />
                )}
                <div className="p-5">
                  <p className="text-xs text-muted">{formatDate(p.publishedAt, locale)}</p>
                  <h2 className="mt-2 text-lg font-medium group-hover:text-primary">{p.title}</h2>
                  <p className="mt-2 line-clamp-3 text-sm text-muted">{p.description}</p>
                  <span className="mt-3 inline-block text-sm text-primary">{t.blog.readMore} →</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
