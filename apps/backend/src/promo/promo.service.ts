import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { CONFIG, type Config } from '../config.js';
import { cursorArgs } from '../designs/designs.service.js';
import { Prisma, type PromoKind } from '../generated/prisma/client.js';
import { isUuid } from '../images/images.service.js';
import { welcomeEmailKey } from '../users/welcome.service.js';
import { BatchSchema, CreateCodeSchema, UpdateCodeSchema, generateCode, maskCode, normalizeCode, proUntilAfter, usable } from './promo.rules.js';

// Promotion and gift codes (API.md §7.29). A code is looked up by its keyed hash; redeeming locks the code row, checks
// it, records the redemption (unique per account and per e-mail identity), grants and counts — all in one transaction
// (BUS-02), so two parallel requests can never both use a single-use code or one person use a code twice.

type CodeRow = {
  id: string; kind: PromoKind; amount: number; maxRedemptions: number | null; redeemed: number;
  startsAt: Date | null; endsAt: Date | null; active: boolean; newUsersOnly: boolean; createdAt: Date;
};

const INVALID = () => new AppError(404, 'invalid_code', 'Kod geçersiz ya da artık kullanılamıyor.');

@Injectable()
export class PromoService {
  constructor(private prisma: PrismaService, @Inject(CONFIG) private cfg: Config) {}

  private hash(normalized: string) {
    return createHmac('sha256', this.cfg.DEVICE_PEPPER).update(`promo:${normalized}`).digest('hex');
  }

  private identity(email: string) {
    return createHmac('sha256', this.cfg.DEVICE_PEPPER).update(`promo-id:${welcomeEmailKey(email)}`).digest('hex');
  }

  async redeem(userId: string, raw: string) {
    const normalized = normalizeCode(raw);
    if (!normalized) throw INVALID();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound();
    // A shared code once per person: only a registered account with a verified address (an address is one person,
    // a guest device is not).
    if (user.isGuest || !user.email || !user.emailVerifiedAt) {
      throw new AppError(403, 'verification_required', 'Kodu kullanmak için kayıtlı ve e-postası doğrulanmış bir hesap gerekir.');
    }
    const hash = this.hash(normalized);
    const identityHash = this.identity(user.email);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<CodeRow[]>`
          SELECT id, kind, amount, "maxRedemptions", redeemed, "startsAt", "endsAt", active, "newUsersOnly", "createdAt"
          FROM "PromoCode" WHERE hash = ${hash} FOR UPDATE`;
        const code = rows[0];
        if (!code || !usable(code, user)) throw INVALID();
        if (await tx.promoRedemption.findFirst({ where: { codeId: code.id, OR: [{ userId }, { identityHash }] }, select: { id: true } })) {
          throw new AppError(409, 'already_redeemed', 'Bu kodu daha önce kullandın.');
        }
        let proUntil: Date | null = null;
        if (code.kind === 'PRO_DAYS') {
          const u = (await tx.$queryRaw<Array<{ plan: string; planExpiresAt: Date | null }>>`
            SELECT plan, "planExpiresAt" FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`)[0];
          if (u.plan === 'PRO' && !u.planExpiresAt) throw new AppError(409, 'already_pro', 'Hesabın zaten süresiz PRO; bu kod sana gün eklemez.');
          proUntil = proUntilAfter(u, code.amount);
        }
        await tx.promoRedemption.create({ data: { codeId: code.id, userId, identityHash, kind: code.kind, amount: code.amount } });
        await tx.promoCode.update({ where: { id: code.id }, data: { redeemed: { increment: 1 } } });
        if (code.kind === 'CREDITS') {
          await tx.user.update({ where: { id: userId }, data: { credits: { increment: code.amount } } });
          await tx.creditLedger.create({ data: { userId, delta: code.amount, reason: 'promo', refId: code.id } });
        } else {
          await tx.user.update({ where: { id: userId }, data: { plan: 'PRO', planExpiresAt: proUntil } });
          await tx.creditLedger.create({ data: { userId, delta: 0, reason: 'promo_pro', refId: code.id } });
        }
        log.info('promo_redeemed', { userId, codeId: code.id, kind: code.kind, amount: code.amount });
        return { kind: code.kind, amount: code.amount, proUntil: proUntil?.toISOString() ?? null };
      });
    } catch (e) {
      // The unique constraints are the last word when two requests of one person race past the check above.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError(409, 'already_redeemed', 'Bu kodu daha önce kullandın.');
      throw e;
    }
  }

  private dto(c: { id: string; display: string; campaign: string; kind: PromoKind; amount: number; maxRedemptions: number | null; redeemed: number; startsAt: Date | null; endsAt: Date | null; active: boolean; newUsersOnly: boolean; createdAt: Date }) {
    return {
      id: c.id, display: c.display, campaign: c.campaign, kind: c.kind, amount: c.amount, maxRedemptions: c.maxRedemptions, redeemed: c.redeemed,
      startsAt: c.startsAt?.toISOString() ?? null, endsAt: c.endsAt?.toISOString() ?? null, active: c.active, newUsersOnly: c.newUsersOnly,
      createdAt: c.createdAt.toISOString(), usable: usable(c, { createdAt: new Date() }),
    };
  }

  async list(q: { campaign?: string; search?: string; cursor?: string; limit: number }) {
    const search = q.search ? normalizeCode(q.search) : null;
    const where: Prisma.PromoCodeWhereInput = {
      ...(q.campaign ? { campaign: q.campaign } : {}),
      ...(q.search ? { OR: [{ campaign: { contains: q.search, mode: 'insensitive' } }, ...(search ? [{ hash: this.hash(search) }] : [])] } : {}),
    };
    const [rows, campaigns] = await Promise.all([
      this.prisma.promoCode.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, ...cursorArgs(q.cursor) }),
      this.prisma.promoCode.groupBy({ by: ['campaign'], _count: { _all: true }, _sum: { redeemed: true }, orderBy: { campaign: 'asc' }, take: 200 }),
    ]);
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((c) => this.dto(c)),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
      campaigns: campaigns.map((c) => ({ campaign: c.campaign, codes: c._count._all, redeemed: c._sum.redeemed ?? 0 })),
    };
  }

  async create(input: z.infer<typeof CreateCodeSchema>, actorId: string) {
    const normalized = normalizeCode(input.code)!;
    try {
      const c = await this.prisma.promoCode.create({
        data: {
          hash: this.hash(normalized), display: normalized, campaign: input.campaign, kind: input.kind, amount: input.amount,
          maxRedemptions: input.maxRedemptions, startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null,
          newUsersOnly: input.newUsersOnly, createdById: actorId,
        },
      });
      return this.dto(c);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError(409, 'code_exists', 'Bu kod zaten var.');
      throw e;
    }
  }

  /** Single-use gift codes; the codes themselves are returned once, here, and never stored in readable form. */
  async batch(input: z.infer<typeof BatchSchema>, actorId: string) {
    const codes = new Map<string, string>(); // normalized → as printed
    while (codes.size < input.count) {
      const printed = generateCode();
      codes.set(normalizeCode(printed)!, printed);
    }
    const common = {
      campaign: input.campaign, kind: input.kind, amount: input.amount, maxRedemptions: 1,
      startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null,
      newUsersOnly: input.newUsersOnly, createdById: actorId,
    };
    // A clash with an existing hash is astronomically unlikely; it is refused rather than silently skipped.
    await this.prisma.promoCode.createMany({ data: [...codes.keys()].map((n) => ({ ...common, hash: this.hash(n), display: maskCode(n) })) });
    return { campaign: input.campaign, kind: input.kind, amount: input.amount, codes: [...codes.values()] };
  }

  async update(id: string, input: z.infer<typeof UpdateCodeSchema>) {
    if (!isUuid(id)) throw notFound();
    const c = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!c) throw notFound();
    if (input.maxRedemptions !== undefined && input.maxRedemptions !== null && input.maxRedemptions < c.redeemed) {
      throw new AppError(400, 'validation_failed', `Sınır şimdiye kadarki kullanımın (${c.redeemed}) altında olamaz.`);
    }
    const updated = await this.prisma.promoCode.update({
      where: { id },
      data: {
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
        ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
      },
    });
    return { before: this.dto(c), after: this.dto(updated) };
  }

  async redemptions(id: string) {
    if (!isUuid(id)) throw notFound();
    const c = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!c) throw notFound();
    const rows = await this.prisma.promoRedemption.findMany({
      where: { codeId: id },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      code: this.dto(c),
      items: rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), user: r.user ? { id: r.user.id, email: r.user.email, name: r.user.name } : null })),
    };
  }
}
