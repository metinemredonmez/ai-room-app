import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Markdown } from "@/components/markdown";
import { blogPost, readingMinutes } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALE_TAGS, fmt, isLocale, localePath, type Locale } from "@/lib/i18n";
import { loadMessages } from "@/lib/messages";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://casalume.app").replace(/\/$/, "");

export async function generateMetadata({ params }: PageProps<"/[locale]/blog/[slug]">): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : "tr";
  const post = await blogPost(locale, slug);
  if (!post) return {};
  const languages = Object.fromEntries(post.translations.map((tr) => [LOCALE_TAGS[tr.locale], `${BASE}${localePath(tr.locale, `/blog/${tr.slug}`)}`]));
  const fallback = post.translations.find((tr) => tr.locale === DEFAULT_LOCALE) ?? post.translations[0];
  if (fallback) languages["x-default"] = `${BASE}${localePath(fallback.locale, `/blog/${fallback.slug}`)}`;
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `${BASE}${localePath(locale, `/blog/${post.slug}`)}`, languages },
    openGraph: { type: "article", title: post.title, description: post.description, publishedTime: post.publishedAt, ...(post.coverUrl ? { images: [post.coverUrl] } : {}) },
  };
}

export default function BlogPostPage({ params }: PageProps<"/[locale]/blog/[slug]">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-16 sm:px-6" />}>
      <Post params={params} />
    </Suspense>
  );
}

async function Post({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params;
  const locale: Locale = isLocale(raw) ? raw : "tr";
  const [t, post] = await Promise.all([loadMessages(locale), blogPost(locale, slug)]);
  if (!post) notFound();
  const others = post.translations.filter((tr) => tr.locale !== locale);
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href={localePath(locale, "/blog")} className="text-sm text-muted hover:text-text">
        ← {t.blog.back}
      </Link>
      <h1 className="mt-6 font-display text-4xl font-light leading-tight sm:text-5xl">{post.title}</h1>
      <p className="mt-4 text-sm text-muted">
        {formatDate(post.publishedAt, locale)} · {fmt(t.blog.minutes, { n: readingMinutes(post.body) })}
      </p>
      {post.coverUrl && (
        <img src={post.coverUrl} alt="" className="mt-8 aspect-[16/9] w-full rounded-2xl object-cover" />
      )}
      <p className="mt-8 text-lg text-muted">{post.description}</p>
      <Markdown source={post.body} locale={locale} />
      <aside className="mt-14 rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <h2 className="font-display text-2xl font-light">{t.blog.ctaTitle}</h2>
        <p className="mt-2 text-muted">{t.blog.ctaBody}</p>
        <Link href={localePath(locale, "/studio")} className="mt-5 inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-white hover:bg-primary-strong">
          {t.blog.ctaButton}
        </Link>
      </aside>
      {others.length > 0 && (
        <p className="mt-10 text-sm text-muted">
          {t.blog.otherLanguages}:{" "}
          {others.map((tr, i) => (
            <span key={tr.locale}>
              {i > 0 && " · "}
              <Link href={localePath(tr.locale, `/blog/${tr.slug}`)} hrefLang={LOCALE_TAGS[tr.locale]} className="hover:text-text">
                {LOCALE_LABELS[tr.locale]}
              </Link>
            </span>
          ))}
        </p>
      )}
    </article>
  );
}
