import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isLocale, type Locale } from '../catalog/catalog.data.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import type { BlogPost, MarketingDraft, Prisma } from '../generated/prisma/client.js';
import { blogArticleSchema, seoSchema } from '../marketing/marketing.rules.js';

type Tx = Prisma.TransactionClient;
export type BlogDraftInput = { mode: 'write' | 'translate'; topic?: string; keywords?: string | null; styleId?: string | null; sourcePostId?: string };

/**
 * Public blog and SEO overrides (API.md §7.18). Articles reach the site only through an ADMIN's approval of a
 * marketing draft; the web renders them without HTML (a small Markdown subset, in-site links only).
 */
@Injectable()
export class BlogService {
  constructor(private prisma: PrismaService, private catalog: CatalogService) {}

  /** Publishes an approved blog draft (inside the approval transaction). Translations join the source's group. */
  async publish(tx: Tx, draft: MarketingDraft, userId: string): Promise<BlogPost> {
    const article = blogArticleSchema.parse(draft.output);
    const input = draft.input as BlogDraftInput;
    let groupId: string = randomUUID();
    let styleId = input.styleId ?? null;
    if (input.mode === 'translate' && input.sourcePostId) {
      const source = await tx.blogPost.findUnique({ where: { id: input.sourcePostId } });
      if (!source) throw new AppError(409, 'conflict', 'Kaynak yazı silinmiş');
      groupId = source.groupId;
      styleId = source.styleId;
    }
    const taken = await tx.blogPost.findUnique({ where: { locale_slug: { locale: draft.locale, slug: article.slug } } });
    if (taken && taken.groupId !== groupId) throw new AppError(409, 'slug_taken', `Bu dilde "${article.slug}" adresi kullanılıyor; adresi değiştir`);
    const data = { ...article, styleId, status: 'PUBLISHED' as const, draftId: draft.id, publishedBy: userId, publishedAt: new Date() };
    return tx.blogPost.upsert({
      where: { groupId_locale: { groupId, locale: draft.locale } },
      create: { groupId, locale: draft.locale, ...data },
      update: data,
    });
  }

  private card(p: BlogPost) {
    return {
      id: p.id,
      groupId: p.groupId,
      locale: p.locale,
      slug: p.slug,
      title: p.title,
      description: p.description,
      coverUrl: p.styleId ? this.catalog.previewUrl(p.styleId) : null,
      status: p.status,
      publishedAt: p.publishedAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async listPublic(locale: Locale) {
    const posts = await this.prisma.blogPost.findMany({
      where: { locale, status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      take: 100,
    });
    return { items: posts.map((p) => this.card(p)) };
  }

  async getPublic(locale: Locale, slug: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { locale_slug: { locale, slug } } });
    if (!post || post.status !== 'PUBLISHED') throw new AppError(404, 'not_found', 'Yazı bulunamadı');
    const siblings = await this.prisma.blogPost.findMany({
      where: { groupId: post.groupId, status: 'PUBLISHED' },
      select: { locale: true, slug: true },
    });
    return { ...this.card(post), body: post.body, translations: siblings };
  }

  /** Every published article, for the sitemap (with its translations for hreflang). */
  async sitemap() {
    const posts = await this.prisma.blogPost.findMany({
      where: { status: 'PUBLISHED' },
      select: { groupId: true, locale: true, slug: true, updatedAt: true },
      orderBy: { publishedAt: 'desc' },
      take: 5000,
    });
    return { items: posts.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })) };
  }

  async adminList() {
    const posts = await this.prisma.blogPost.findMany({ orderBy: { publishedAt: 'desc' }, take: 500 });
    return { items: posts.map((p) => this.card(p)) };
  }

  async setStatus(id: string, status: 'DRAFT' | 'PUBLISHED') {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new AppError(404, 'not_found', 'Yazı bulunamadı');
    return this.card(await this.prisma.blogPost.update({ where: { id }, data: { status } }));
  }

  /** Approved SEO texts of a language: `{ pages: { home: { title, description }, … } }` (empty when none). */
  async seoMeta(locale: string) {
    if (!isLocale(locale)) return { pages: {} };
    const d = await this.prisma.marketingDraft.findFirst({
      where: { kind: 'seo', locale, status: 'APPROVED' },
      orderBy: { approvedAt: 'desc' },
    });
    const parsed = seoSchema.safeParse(d?.output);
    if (!parsed.success) return { pages: {} };
    return { pages: Object.fromEntries(parsed.data.pages.map((p) => [p.key, { title: p.title, description: p.description }])) };
  }
}
