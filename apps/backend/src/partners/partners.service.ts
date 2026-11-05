import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { REVENUE_EVENT_TYPES } from '../admin/analytics.rules.js';
import { AppError, notFound } from '../common/errors.js';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { CONFIG, type Config } from '../config.js';
import { Prisma } from '../generated/prisma/client.js';
import { isUuid } from '../images/images.service.js';

// Influencer / partner links (API.md §7.33; YediOda #66). casalume.app/p/<slug> counts a visit and remembers the
// partner on the device for 30 days; a new account (at most 24 h old) is then attributed once. The report counts what
// those people did — sign-up, verification, first design, payment and net revenue (RevenueCat USD, refunds negative,
// production only) — and an estimated commission. Measurement only: rewards for the audience are promo codes.

export const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const ATTRIBUTION_WINDOW_MS = 24 * 3600 * 1000;

export const CreatePartnerSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: z.string().trim().toLowerCase().regex(SLUG),
    commissionPct: z.number().int().min(0).max(50).default(0),
    note: z.string().trim().max(300).nullable().default(null),
    reason: z.string().trim().min(3).max(200),
  })
  .strict();
export const UpdatePartnerSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    commissionPct: z.number().int().min(0).max(50).optional(),
    note: z.string().trim().max(300).nullable().optional(),
    active: z.boolean().optional(),
    reason: z.string().trim().min(3).max(200),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, { message: 'nothing_to_change' });

type Metrics = { partner_id: string; signups: bigint; verified: bigint; designers: bigint; payers: bigint; revenue: number | null };

@Injectable()
export class PartnersService {
  constructor(private prisma: PrismaService, @Inject(CONFIG) private cfg: Config) {}

  link(slug: string) {
    return `${this.cfg.WEB_APP_URL}/p/${slug}`;
  }

  /** Public: one visit to an active partner's link (unknown or paused: nothing counted, no error page for the visitor). */
  async visit(rawSlug: string) {
    const slug = rawSlug.toLowerCase();
    if (!SLUG.test(slug)) return { counted: false };
    const p = await this.prisma.partner.findUnique({ where: { slug }, select: { id: true, active: true } });
    if (!p?.active) return { counted: false };
    const day = todayInIstanbul();
    await this.prisma.$executeRaw`
      INSERT INTO "PartnerVisitDay" ("partnerId", day, count) VALUES (${p.id}::uuid, ${day}, 1)
      ON CONFLICT ("partnerId", day) DO UPDATE SET count = "PartnerVisitDay".count + 1`;
    return { counted: true };
  }

  /** The signed-in user came through a partner link: attributed once, and only while the account is new. */
  async attribute(userId: string, rawSlug: string) {
    const slug = rawSlug.toLowerCase();
    if (!SLUG.test(slug)) return { attributed: false };
    const [user, p] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, role: true } }),
      this.prisma.partner.findUnique({ where: { slug }, select: { id: true, active: true } }),
    ]);
    if (!user || !p?.active || user.role !== 'USER') return { attributed: false };
    if (Date.now() - user.createdAt.getTime() > ATTRIBUTION_WINDOW_MS) return { attributed: false };
    try {
      await this.prisma.partnerAttribution.create({ data: { userId, partnerId: p.id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { attributed: false }; // first partner stays
      throw e;
    }
    log.info('partner_attributed', { userId, partnerId: p.id });
    return { attributed: true };
  }

  async list() {
    const partners = await this.prisma.partner.findMany({ orderBy: { createdAt: 'desc' } });
    if (!partners.length) return { items: [] };
    const since = todayInIstanbul(new Date(Date.now() - 29 * 24 * 3600 * 1000));
    const [visits, metrics] = await Promise.all([
      this.prisma.partnerVisitDay.groupBy({ by: ['partnerId'], _sum: { count: true } }),
      this.prisma.$queryRaw<Metrics[]>`
        SELECT a."partnerId" AS partner_id,
          COUNT(*) FILTER (WHERE u."isGuest" = false) AS signups,
          COUNT(*) FILTER (WHERE u."emailVerifiedAt" IS NOT NULL) AS verified,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Design" d WHERE d."userId" = u.id AND d.status = 'SUCCEEDED')) AS designers,
          COUNT(*) FILTER (WHERE r.revenue > 0) AS payers,
          SUM(COALESCE(r.revenue, 0))::float8 AS revenue
        FROM "PartnerAttribution" a
        JOIN "User" u ON u.id = a."userId"
        LEFT JOIN LATERAL (
          SELECT SUM(CASE WHEN jsonb_typeof(w.payload->'price') = 'number' THEN (w.payload->>'price')::float8 ELSE 0 END) AS revenue
          FROM "WebhookEvent" w
          WHERE w."userId" = u.id AND w.source = 'revenuecat' AND w.type IN (${Prisma.join([...REVENUE_EVENT_TYPES])})
            AND COALESCE(w.payload->>'environment', 'PRODUCTION') = 'PRODUCTION'
        ) r ON true
        GROUP BY a."partnerId"`,
    ]);
    const recent = await this.prisma.partnerVisitDay.groupBy({ by: ['partnerId'], where: { day: { gte: since } }, _sum: { count: true } });
    const v = new Map(visits.map((x) => [x.partnerId, x._sum.count ?? 0]));
    const v30 = new Map(recent.map((x) => [x.partnerId, x._sum.count ?? 0]));
    const m = new Map(metrics.map((x) => [x.partner_id, x]));
    return {
      items: partners.map((p) => {
        const x = m.get(p.id);
        const revenue = Math.round((x?.revenue ?? 0) * 100) / 100;
        return {
          id: p.id, slug: p.slug, name: p.name, note: p.note, commissionPct: p.commissionPct, active: p.active, createdAt: p.createdAt.toISOString(),
          link: this.link(p.slug),
          visits: v.get(p.id) ?? 0,
          visits30: v30.get(p.id) ?? 0,
          signups: Number(x?.signups ?? 0),
          verified: Number(x?.verified ?? 0),
          designers: Number(x?.designers ?? 0),
          payers: Number(x?.payers ?? 0),
          revenueUsd: revenue,
          commissionUsd: Math.round(revenue * p.commissionPct) / 100,
        };
      }),
    };
  }

  async create(input: z.infer<typeof CreatePartnerSchema>, actorId: string) {
    try {
      return await this.prisma.partner.create({ data: { name: input.name, slug: input.slug, commissionPct: input.commissionPct, note: input.note, createdById: actorId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError(409, 'slug_taken', 'Bu bağlantı adı kullanılıyor.');
      throw e;
    }
  }

  async update(id: string, input: z.infer<typeof UpdatePartnerSchema>) {
    if (!isUuid(id)) throw notFound();
    const before = await this.prisma.partner.findUnique({ where: { id } });
    if (!before) throw notFound();
    const { reason: _r, ...data } = input;
    const after = await this.prisma.partner.update({ where: { id }, data });
    return { before, after };
  }
}
