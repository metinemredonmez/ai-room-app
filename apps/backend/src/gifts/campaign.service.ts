import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { contentLocale } from '../catalog/catalog.data.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma } from '../generated/prisma/client.js';
import { PushService, type PushMessage } from '../push/push.service.js';

// Group gifts (API.md §7.32; YediOda #63 "dönüş hediyesi", "sadakat"): credits to a segment, with a push. Recipients
// are real people only (verified, active, not staff, not guests). Each chunk is one SQL statement that records the
// recipient, adds the credit and writes the ledger line together, and `ON CONFLICT DO NOTHING` on the recipient key
// means a retried or repeated run never pays anyone twice (BUS-02).

export const SEGMENTS = ['inactive', 'pro', 'new', 'all'] as const;
export type Segment = (typeof SEGMENTS)[number];
export const MAX_RECIPIENTS = 20_000;
const CHUNK = 500;

const base = {
  segment: z.enum(SEGMENTS),
  /** inactive: not seen for at least this many days; new: signed up within this many days. */
  days: z.number().int().min(1).max(365).nullable().default(null),
};
export const PreviewSchema = z.object(base).strict().refine((v) => (v.segment === 'inactive' || v.segment === 'new' ? v.days !== null : true), { message: 'days_required', path: ['days'] });
export const SendSchema = z
  .object({
    ...base,
    credits: z.number().int().min(1).max(100),
    message: z.string().trim().max(140).default(''),
    reason: z.string().trim().min(3).max(200),
    /** The count the admin saw in the preview: the send stops if the segment grew far beyond it. */
    expected: z.number().int().min(0),
  })
  .strict()
  .refine((v) => (v.segment === 'inactive' || v.segment === 'new' ? v.days !== null : true), { message: 'days_required', path: ['days'] });

/** WHERE for a segment; every segment starts from real, reachable people. */
export function segmentWhere(segment: Segment, days: number | null, now = new Date()): Prisma.Sql {
  const people = Prisma.sql`u.role = 'USER' AND u.status = 'ACTIVE' AND u."isGuest" = false AND u."emailVerifiedAt" IS NOT NULL`;
  const ago = new Date(now.getTime() - (days ?? 0) * 24 * 3600 * 1000);
  switch (segment) {
    case 'inactive':
      return Prisma.sql`${people} AND COALESCE(u."lastSeenAt", u."createdAt") < ${ago}`;
    case 'new':
      return Prisma.sql`${people} AND u."createdAt" >= ${ago}`;
    case 'pro':
      return Prisma.sql`${people} AND ((u.plan = 'PRO' AND (u."planExpiresAt" IS NULL OR u."planExpiresAt" > ${now})) OR u."storeProUntil" > ${now})`;
    default:
      return people;
  }
}

const PUSH = {
  tr: (n: number) => ({ title: `Hediye: ${n} kredi`, body: 'Seni özledik! Casalume ekibinden sana hediye kredi; hemen yeni bir tasarım dene.' }),
  en: (n: number) => ({ title: `Gift: ${n} credits`, body: 'We missed you! A gift from the Casalume team; try a new design now.' }),
};

@Injectable()
export class GiftCampaignService {
  constructor(private prisma: PrismaService, private push: PushService) {}

  async preview(segment: Segment, days: number | null) {
    const where = segmentWhere(segment, days);
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint; with_push: bigint }>>`
      SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "PushToken" p WHERE p."userId" = u.id)) AS with_push
      FROM "User" u WHERE ${where}`;
    return { count: Number(rows[0]?.n ?? 0), withPush: Number(rows[0]?.with_push ?? 0), max: MAX_RECIPIENTS };
  }

  async send(input: z.infer<typeof SendSchema>, actorId: string) {
    const { count } = await this.preview(input.segment, input.days);
    if (count === 0) throw new AppError(400, 'empty_segment', 'Bu grupta kimse yok.');
    if (count > MAX_RECIPIENTS) throw new AppError(400, 'too_many', `Bir seferde en çok ${MAX_RECIPIENTS} kişiye gönderilir; grubu daralt.`);
    if (count > input.expected * 1.1 + 10) throw new AppError(409, 'count_changed', `Grup önizlemeden bu yana büyüdü (${count} kişi); yeniden önizle.`);

    // A double click or a second admin sending the same gift within 10 minutes is refused (BUS-02).
    const campaign = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext('gift-campaign'))) AS l`;
      const recent = await tx.giftCampaign.findFirst({
        where: { segment: input.segment, days: input.days, credits: input.credits, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
      });
      if (recent) throw new AppError(409, 'duplicate_send', 'Aynı hediye 10 dakika içinde zaten gönderildi.');
      return tx.giftCampaign.create({ data: { segment: input.segment, days: input.days, credits: input.credits, message: input.message, createdById: actorId } });
    });

    const where = segmentWhere(input.segment, input.days);
    const ids = (await this.prisma.$queryRaw<Array<{ id: string }>>`SELECT u.id FROM "User" u WHERE ${where} ORDER BY u.id LIMIT ${MAX_RECIPIENTS}`).map((r) => r.id);
    let given = 0;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        // Recipient row, credit and ledger line in one statement; already-recorded recipients are skipped.
        given += await this.prisma.$executeRaw`
          WITH ins AS (
            INSERT INTO "GiftRecipient" ("campaignId", "userId")
            SELECT ${campaign.id}::uuid, x FROM unnest(${chunk}::uuid[]) AS x
            ON CONFLICT DO NOTHING RETURNING "userId"
          ), upd AS (
            UPDATE "User" SET credits = credits + ${input.credits} WHERE id IN (SELECT "userId" FROM ins) RETURNING id
          )
          INSERT INTO "CreditLedger" (id, "userId", delta, reason, "refId", "createdAt")
          SELECT gen_random_uuid(), id, ${input.credits}, 'gift', ${campaign.id}, now() FROM upd`;
      }
    } catch (e) {
      await this.prisma.giftCampaign.update({ where: { id: campaign.id }, data: { status: 'FAILED', recipients: given, finishedAt: new Date() } });
      throw e;
    }
    await this.prisma.giftCampaign.update({ where: { id: campaign.id }, data: { status: 'SENT', recipients: given, finishedAt: new Date() } });
    log.info('gift_campaign_sent', { campaignId: campaign.id, segment: input.segment, recipients: given });
    // Notifications after the credits, in the background: a slow push service never holds the credits back.
    void this.notify(campaign.id, ids, input.credits, input.message).catch((e: Error) => log.warn('gift_campaign_push_failed', { campaignId: campaign.id, error: e.name }));
    return { id: campaign.id, recipients: given };
  }

  private async notify(campaignId: string, ids: string[], credits: number, message: string) {
    let pushed = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const users = await this.prisma.user.findMany({ where: { id: { in: ids.slice(i, i + CHUNK) } }, select: { locale: true, pushTokens: { select: { token: true } } } });
      const messages: PushMessage[] = users.flatMap((u) => {
        const c = PUSH[contentLocale(u.locale)](credits);
        return u.pushTokens.map(({ token }) => ({ to: token, title: c.title, body: message || c.body, sound: 'default' as const, priority: 'high' as const, channelId: 'designs' as const, data: { type: 'gift', path: '/hesap' } }));
      });
      if (messages.length) {
        await this.push.send(messages);
        pushed += messages.length;
      }
    }
    await this.prisma.giftCampaign.update({ where: { id: campaignId }, data: { pushed } });
  }

  async history() {
    const rows = await this.prisma.giftCampaign.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    const ids = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    const who = new Map((ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : []).map((u) => [u.id, u.name ?? u.email]));
    return {
      items: rows.map((r) => ({
        id: r.id, segment: r.segment, days: r.days, credits: r.credits, message: r.message, recipients: r.recipients, pushed: r.pushed, status: r.status,
        createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, createdBy: r.createdById ? (who.get(r.createdById) ?? null) : null,
      })),
    };
  }
}
