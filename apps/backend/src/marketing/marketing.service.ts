import { Inject, Injectable } from '@nestjs/common';
import { AiClient, AiError } from '../ai/ai.client.js';
import { BlogService, type BlogDraftInput } from '../blog/blog.service.js';
import { BroadcastsService } from '../broadcasts/broadcasts.service.js';
import { LINKS } from '../broadcasts/broadcast.rules.js';
import { LOCALES, isLocale, type Locale } from '../catalog/catalog.data.js';
import { localize } from '../catalog/catalog.i18n.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AppError, parse } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { CONFIG, type Config } from '../config.js';
import { Prisma, type MarketingDraft } from '../generated/prisma/client.js';
import { QueuesService } from '../jobs/queues.service.js';
import { MailerService } from '../mail/mailer.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { UsageService, type AiUsageReport } from '../usage/usage.service.js';
import { hasStylePhoto, renderBeforeAfter, type SocialFormat } from './marketing.images.js';
import {
  AsoListingSchema, BLOG_LINKS, SEO_PAGES, blogArticleSchema, blogViolations, buildFacts, campaignSchema, campaignViolations,
  playListings, seoSchema, seoViolations, socialPostSchema, socialViolations, storeConfig, violationsOf, type AsoListing,
  type AsoRun, type BlogRun, type BlogTranslate, type CampaignRun, type Channel, type Platform, type SocialRun,
} from './marketing.rules.js';
import { renderWeeklyReport, weeklyMetrics, type WeeklyMetrics } from './weekly-report.js';

export const DRAFT_KINDS = ['aso', 'social', 'campaign', 'report', 'blog', 'seo'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

type SocialInput = { styleId: string; platform: Platform; brief: string | null };
type CampaignInput = { channel: Channel; kind: 'SERVICE' | 'MARKETING'; goal: string };
type ReportInput = { metrics: WeeklyMetrics; send: boolean };
type Written = { output: unknown; violations: string[]; usage?: AiUsageReport; error?: string };

const notFound = () => new AppError(404, 'not_found', 'Taslak bulunamadı');
const LINK_PATHS = LINKS.map((l) => l.path);

/**
 * Admin "Pazarlama" (API.md §7.18). AI writes drafts in the background (one job per draft); the owner edits and
 * approves them. Nothing is published or sent to users from here (AI-02): store texts are exported as files,
 * social posts are downloaded, a campaign becomes a Toplu Gönderim DRAFT that goes through its own checks.
 * The only mail sent is the weekly report, to the SUPER_ADMIN addresses.
 */
@Injectable()
export class MarketingService {
  constructor(
    private prisma: PrismaService,
    private queues: QueuesService,
    private ai: AiClient,
    private usage: UsageService,
    private catalog: CatalogService,
    private settings: SettingsService,
    private broadcasts: BroadcastsService,
    private mailer: MailerService,
    @Inject(CONFIG) private cfg: Config,
    private blog: BlogService,
  ) {}

  async facts(locale: Locale = 'en') {
    const styles = await this.catalog.styles();
    const s = this.settings.current;
    return buildFacts({ locale, styles, freeDaily: s.freeDailyGenerations, maxVariantsFree: s.maxVariantsFree });
  }

  // ------------------------------------------------------------------------------------------------ runs

  private async assertBudget() {
    const budget = await this.usage.budget();
    if (budget.state === 'exceeded') {
      throw new AppError(503, 'budget_exceeded', 'Günlük yapay zekâ bütçesi doldu; yarın ya da bütçeyi artırınca tekrar dene');
    }
  }

  private async queue(kind: DraftKind, rows: Array<{ locale: string; input: Prisma.InputJsonValue }>, userId: string | null) {
    const drafts = await this.prisma.$transaction(
      rows.map((r) => this.prisma.marketingDraft.create({ data: { kind, locale: r.locale, input: r.input, createdById: userId } })),
    );
    for (const d of drafts) await this.queues.marketing.add(kind, { draftId: d.id }, { jobId: d.id });
    return { items: drafts.map((d) => this.dto(d)) };
  }

  /** Store listing: one draft per language. A language already being written can't be started twice. */
  async runAso(input: AsoRun, userId: string) {
    await this.assertBudget();
    const busy = await this.prisma.marketingDraft.findMany({
      where: { kind: 'aso', status: 'PENDING', locale: { in: input.locales } },
      select: { locale: true },
    });
    if (busy.length) {
      throw new AppError(409, 'conflict', `Bu diller zaten yazılıyor: ${[...new Set(busy.map((b) => b.locale))].join(', ')}`);
    }
    const payload = { brief: input.brief || null, whatsNew: input.whatsNew || null };
    return this.queue('aso', input.locales.map((locale) => ({ locale, input: payload })), userId);
  }

  /** Social posts: one draft per style × platform × language, only for styles with a curated photo. */
  async runSocial(input: SocialRun, userId: string) {
    await this.assertBudget();
    const active = new Set((await this.catalog.styles()).map((s) => s.id));
    for (const id of input.styleIds) {
      if (!active.has(id) || !(await hasStylePhoto(id))) throw new AppError(400, 'validation_failed', `Bu stilin örnek fotoğrafı yok: ${id}`);
    }
    const rows = input.styleIds.flatMap((styleId) =>
      input.platforms.flatMap((platform) =>
        input.locales.map((locale) => ({ locale, input: { styleId, platform, brief: input.brief || null } satisfies SocialInput })),
      ),
    );
    return this.queue('social', rows, userId);
  }

  /** Toplu Gönderim text: one draft per language (the broadcast is later sent to that language's users only). */
  async runCampaign(input: CampaignRun, userId: string) {
    await this.assertBudget();
    const payload: CampaignInput = { channel: input.channel, kind: input.kind, goal: input.goal };
    return this.queue('campaign', input.locales.map((locale) => ({ locale, input: payload })), userId);
  }

  /** Blog article written from a topic, in one language (Turkish by default). */
  async runBlog(input: BlogRun, userId: string) {
    await this.assertBudget();
    if (input.styleId && !(await this.catalog.styles()).some((s) => s.id === input.styleId)) {
      throw new AppError(400, 'validation_failed', 'Stil bulunamadı');
    }
    const payload: BlogDraftInput = { mode: 'write', topic: input.topic, keywords: input.keywords || null, styleId: input.styleId ?? null };
    return this.queue('blog', [{ locale: input.locale, input: payload }], userId);
  }

  /** Translations of a published article; approving one publishes it as that article's language version. */
  async runBlogTranslate(input: BlogTranslate, userId: string) {
    await this.assertBudget();
    const source = await this.prisma.blogPost.findUnique({ where: { id: input.postId } });
    if (!source || source.status !== 'PUBLISHED') throw new AppError(404, 'not_found', 'Yayındaki yazı bulunamadı');
    const locales = input.locales.filter((l) => l !== source.locale);
    if (!locales.length) throw new AppError(400, 'validation_failed', 'Yazının kendi dili dışında bir dil seç');
    const payload: BlogDraftInput = { mode: 'translate', sourcePostId: source.id, styleId: source.styleId };
    return this.queue('blog', locales.map((locale) => ({ locale, input: payload })), userId);
  }

  /** Page titles and descriptions, one draft per language; approved ones are served to the web (§7.18). */
  async runSeo(locales: Locale[], userId: string) {
    await this.assertBudget();
    return this.queue('seo', locales.map((locale) => ({ locale, input: {} })), userId);
  }

  /** Weekly report: numbers now, Claude's reading in the worker; `send` mails it to the SUPER_ADMINs. */
  async runReport(send: boolean, userId: string | null) {
    const metrics = await weeklyMetrics(this.prisma);
    const input: ReportInput = { metrics, send };
    return this.queue('report', [{ locale: 'tr', input: input as unknown as Prisma.InputJsonValue }], userId);
  }

  // ----------------------------------------------------------------------------------------------- worker

  /** Writes one draft. Retryable AI errors go back to the queue; anything else marks the draft FAILED. */
  async process(draftId: string, finalAttempt: boolean) {
    const draft = await this.prisma.marketingDraft.findUnique({ where: { id: draftId } });
    if (!draft || draft.status !== 'PENDING' || !isLocale(draft.locale)) return { skipped: true };
    try {
      const out: Written | null =
        draft.kind === 'aso' ? await this.writeAso(draft, draft.locale)
        : draft.kind === 'social' ? await this.writeSocial(draft, draft.locale)
        : draft.kind === 'campaign' ? await this.writeCampaign(draft, draft.locale)
        : draft.kind === 'report' ? await this.writeReport(draft)
        : draft.kind === 'blog' ? await this.writeBlog(draft, draft.locale)
        : draft.kind === 'seo' ? await this.writeSeo(draft.locale)
        : null;
      if (!out) throw new AppError(400, 'unknown_kind');
      await this.usage.record(out.usage);
      await this.prisma.marketingDraft.update({
        where: { id: draftId },
        data: {
          status: 'READY',
          output: out.output as Prisma.InputJsonValue,
          violations: out.violations,
          costUsd: new Prisma.Decimal(Math.max(0, Number(out.usage?.cost_usd ?? 0)).toFixed(6)),
          error: out.error ?? null,
        },
      });
      if (draft.kind === 'report' && (draft.input as ReportInput).send) await this.mailReport(draftId);
      return { ok: true };
    } catch (e) {
      if (e instanceof AiError && e.retryable && !finalAttempt) throw e;
      log.warn('marketing_draft_failed', { draftId, kind: draft.kind, error: e instanceof AppError ? e.code : (e as Error).name });
      await this.prisma.marketingDraft.update({
        where: { id: draftId },
        data: { status: 'FAILED', error: e instanceof AppError ? e.code : 'internal' },
      });
      return { failed: true };
    }
  }

  private async writeAso(draft: MarketingDraft, locale: Locale): Promise<Written> {
    const input = draft.input as { brief?: string | null; whatsNew?: string | null };
    const out = await this.ai.marketingAso({
      locale,
      facts: await this.facts(locale),
      ...(input.brief ? { brief: input.brief } : {}),
      ...(input.whatsNew ? { whats_new: input.whatsNew } : {}),
    });
    return { output: out.listing, violations: violationsOf(out.listing as unknown as Record<string, unknown>), usage: out.usage };
  }

  private async writeSocial(draft: MarketingDraft, locale: Locale): Promise<Written> {
    const input = draft.input as SocialInput;
    const style = await this.catalog.style(input.styleId);
    const out = await this.ai.marketingSocial({
      locale,
      platform: input.platform,
      style_name: localize(locale, `styles.${style.id}.name`, { tr: style.nameTr, en: style.nameEn }),
      style_description: localize(locale, `styles.${style.id}.description`, { tr: style.descriptionTr, en: style.descriptionEn }).slice(0, 300),
      facts: await this.facts(locale),
      ...(input.brief ? { brief: input.brief } : {}),
    });
    return { output: out.post, violations: socialViolations(input.platform, out.post as unknown as Record<string, unknown>), usage: out.usage };
  }

  private async writeCampaign(draft: MarketingDraft, locale: Locale): Promise<Written> {
    const input = draft.input as CampaignInput;
    const out = await this.ai.marketingCampaign({
      locale,
      channel: input.channel,
      kind: input.kind,
      goal: input.goal,
      facts: await this.facts(locale),
      links: LINK_PATHS.filter((p) => input.kind === 'MARKETING' || p !== '/fiyatlar'),
    });
    const output = { ...out.message, link: out.message.link ?? null };
    const violations = campaignViolations(input.channel, output);
    // The same commercial-text check the broadcast itself runs (6563 / İYS): flagged here so the owner sees it early.
    const check = this.broadcasts.precheck({ title: output.title, body: output.body, link: output.link, kind: input.kind, channel: input.channel });
    return { output: { ...output, signals: check.signals }, violations: check.blocked ? [...violations, 'looks_commercial'] : violations, usage: out.usage };
  }

  private async writeReport(draft: MarketingDraft): Promise<Written> {
    const input = draft.input as unknown as ReportInput;
    try {
      const out = await this.ai.marketingReport({ metrics: JSON.stringify(input.metrics) });
      return { output: { metrics: input.metrics, text: out.report }, violations: [], usage: out.usage };
    } catch (e) {
      // The numbers matter more than the commentary: the report still goes out without it.
      if (!(e instanceof AiError)) throw e;
      return { output: { metrics: input.metrics, text: null }, violations: [], usage: undefined, error: e.code };
    }
  }

  private async writeBlog(draft: MarketingDraft, locale: Locale): Promise<Written> {
    const input = draft.input as BlogDraftInput;
    let source: { title: string; description: string; body: string } | undefined;
    if (input.mode === 'translate') {
      const post = input.sourcePostId ? await this.prisma.blogPost.findUnique({ where: { id: input.sourcePostId } }) : null;
      if (!post) throw new AppError(409, 'source_missing');
      source = { title: post.title, description: post.description, body: post.body };
    }
    const out = await this.ai.marketingBlog({
      locale,
      facts: await this.facts(locale),
      links: [...BLOG_LINKS],
      ...(source ? { source } : { topic: input.topic ?? '' }),
      ...(input.keywords ? { keywords: input.keywords } : {}),
    });
    return { output: out.article, violations: blogViolations(out.article as unknown as Record<string, unknown>), usage: out.usage };
  }

  private async writeSeo(locale: Locale): Promise<Written> {
    const out = await this.ai.marketingSeo({ locale, facts: await this.facts(locale), pages: SEO_PAGES.map((p) => ({ ...p })) });
    const output = { pages: out.pages };
    const missing = SEO_PAGES.filter((p) => !out.pages.some((x) => x.key === p.key)).map((p) => `${p.key}.missing`);
    return { output, violations: [...seoViolations(output), ...missing], usage: out.usage };
  }

  private async mailReport(draftId: string) {
    const draft = await this.prisma.marketingDraft.findUnique({ where: { id: draftId } });
    const output = draft?.output as { metrics: WeeklyMetrics; text: { summary: string; highlights: string[]; actions: string[] } | null } | null;
    if (!output) return;
    const owners = await this.prisma.user.findMany({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE', email: { not: null } }, select: { email: true } });
    for (const o of owners) {
      await this.mailer
        .send(renderWeeklyReport({ to: o.email!, metrics: output.metrics, text: output.text, adminUrl: `${this.cfg.ADMIN_APP_URL}/marketing/report` }))
        .catch((e: Error) => log.warn('weekly_report_mail_failed', { error: e.name }));
    }
  }

  // ----------------------------------------------------------------------------------------- owner actions

  async list(kind: DraftKind) {
    const items = await this.prisma.marketingDraft.findMany({
      where: { kind, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { items: items.map((d) => this.dto(d)), locales: LOCALES };
  }

  private editSchema(draft: MarketingDraft) {
    if (draft.kind === 'aso') return AsoListingSchema;
    if (draft.kind === 'social') return socialPostSchema((draft.input as SocialInput).platform);
    if (draft.kind === 'campaign') return campaignSchema((draft.input as CampaignInput).channel, LINK_PATHS);
    if (draft.kind === 'blog') return blogArticleSchema;
    if (draft.kind === 'seo') return seoSchema;
    throw new AppError(409, 'conflict', 'Bu taslak düzenlenemez');
  }

  /** Owner's edit, held to the same limits. An approved text that changes needs approving again. */
  async update(id: string, output: unknown) {
    const draft = await this.prisma.marketingDraft.findUnique({ where: { id } });
    if (!draft) throw notFound();
    if (draft.status !== 'READY' && draft.status !== 'APPROVED') {
      throw new AppError(409, 'conflict', 'Yalnız hazır ya da onaylı taslak düzenlenebilir');
    }
    const value = parse(this.editSchema(draft), output) as Record<string, unknown>;
    let violations: string[] = [];
    if (draft.kind === 'campaign') {
      const input = draft.input as CampaignInput;
      const check = this.broadcasts.precheck({ ...(value as { title: string; body: string; link: string | null }), kind: input.kind, channel: input.channel });
      value.signals = check.signals;
      if (check.blocked) violations = ['looks_commercial'];
    }
    const saved = await this.prisma.marketingDraft.update({
      where: { id },
      data: { output: value as Prisma.InputJsonValue, violations, status: 'READY', approvedAt: null, approvedById: null },
    });
    return this.dto(saved);
  }

  /** Approving a store listing makes it its language's current text (the previous one is archived). */
  async approve(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.marketingDraft.findUnique({ where: { id } });
      if (!draft) throw notFound();
      if (draft.status !== 'READY' || draft.kind === 'report') throw new AppError(409, 'conflict', 'Yalnız hazır taslak onaylanabilir');
      if (draft.violations.length) {
        throw new AppError(422, 'over_limit', `Düzeltilmesi gereken alanlar var: ${draft.violations.join(', ')}`);
      }
      // Store listing and SEO texts: one current text per language, the previous one is archived.
      if (draft.kind === 'aso' || draft.kind === 'seo') {
        await tx.marketingDraft.updateMany({ where: { kind: draft.kind, locale: draft.locale, status: 'APPROVED' }, data: { status: 'ARCHIVED' } });
      }
      // A blog article goes live on approval.
      if (draft.kind === 'blog') await this.blog.publish(tx, draft, userId);
      const saved = await tx.marketingDraft.update({ where: { id }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() } });
      return this.dto(saved);
    });
  }

  async archive(id: string) {
    const draft = await this.prisma.marketingDraft.findUnique({ where: { id } });
    if (!draft) throw notFound();
    if (draft.status === 'PENDING') throw new AppError(409, 'conflict', 'Yazılmakta olan taslak arşivlenemez');
    const saved = await this.prisma.marketingDraft.update({ where: { id }, data: { status: 'ARCHIVED' } });
    return this.dto(saved);
  }

  /** Store files, from the approved listings only. */
  async exportAso() {
    const approved = await this.prisma.marketingDraft.findMany({ where: { kind: 'aso', status: 'APPROVED' } });
    const listings: Partial<Record<Locale, AsoListing>> = {};
    for (const d of approved) {
      const parsed = AsoListingSchema.safeParse(d.output);
      if (isLocale(d.locale) && parsed.success) listings[d.locale] = parsed.data;
    }
    return { locales: Object.keys(listings), appStore: storeConfig(listings), googlePlay: playListings(listings) };
  }

  /** Before/after image of a social draft. */
  async image(id: string, format: SocialFormat) {
    const draft = await this.prisma.marketingDraft.findUnique({ where: { id } });
    if (!draft || draft.kind !== 'social') throw notFound();
    const { styleId } = draft.input as SocialInput;
    if (!(await hasStylePhoto(styleId))) throw notFound();
    return renderBeforeAfter(styleId, format);
  }

  /** Styles that can be posted (they have a curated photo made from the sample room). */
  async socialStyles() {
    const styles = await this.catalog.styles();
    const out = [];
    for (const s of styles) if (await hasStylePhoto(s.id)) out.push({ id: s.id, name: s.nameTr, previewUrl: this.catalog.previewUrl(s.id) });
    return { items: out };
  }

  /**
   * An approved campaign text becomes a Toplu Gönderim DRAFT for that language's users. The broadcast keeps its
   * own checks (commercial text, consent, caps, quiet hours) and is sent from the Toplu Gönderim screen.
   */
  async toBroadcast(id: string, userId: string) {
    const draft = await this.prisma.marketingDraft.findUnique({ where: { id } });
    if (!draft || draft.kind !== 'campaign') throw notFound();
    if (draft.status !== 'APPROVED') throw new AppError(409, 'conflict', 'Önce taslağı onayla');
    const out = draft.output as { title: string; body: string; link: string | null; broadcastId?: string };
    if (out.broadcastId) throw new AppError(409, 'conflict', 'Bu metinden zaten bir gönderim taslağı açıldı');
    const input = draft.input as CampaignInput;
    const b = await this.broadcasts.create(
      { title: out.title, body: out.body, link: out.link, kind: input.kind, channel: input.channel, audience: { accounts: 'all', locale: draft.locale as Locale } },
      userId,
    );
    await this.prisma.marketingDraft.update({ where: { id }, data: { output: { ...out, broadcastId: b.id } } });
    return { broadcastId: b.id };
  }

  /** Stuck PENDING drafts (the job was lost, e.g. Redis flushed) are failed after an hour; a full run takes ~10 min. */
  async reconcile() {
    const { count } = await this.prisma.marketingDraft.updateMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 60 * 60_000) } },
      data: { status: 'FAILED', error: 'timeout' },
    });
    return count;
  }

  private dto(d: MarketingDraft) {
    return {
      id: d.id,
      kind: d.kind,
      locale: d.locale,
      status: d.status,
      input: d.input,
      output: d.output,
      violations: d.violations,
      error: d.error,
      costUsd: Number(d.costUsd),
      createdById: d.createdById,
      approvedById: d.approvedById,
      approvedAt: d.approvedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }
}
