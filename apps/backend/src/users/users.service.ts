import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { AppError } from '../common/errors.js';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import type { User } from '../generated/prisma/client.js';

export interface Charge {
  day: string;
  fromFree: number;
  fromCredits: number;
}

type QuotaRow = Pick<User, 'plan' | 'planExpiresAt' | 'credits' | 'freeUsedOn' | 'freeUsedCount'>;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, @Inject(CONFIG) private cfg: Config) {}

  isPro(u: Pick<User, 'plan' | 'planExpiresAt'>, now = new Date()): boolean {
    return u.plan === 'PRO' && (!u.planExpiresAt || u.planExpiresAt > now);
  }

  dailyLimit(u: Pick<User, 'plan' | 'planExpiresAt'>) {
    return this.isPro(u) ? this.cfg.PRO_DAILY_GENERATIONS : this.cfg.FREE_DAILY_GENERATIONS;
  }

  freeRemaining(u: QuotaRow): number {
    const used = u.freeUsedOn === todayInIstanbul() ? u.freeUsedCount : 0;
    return Math.max(0, this.dailyLimit(u) - used);
  }

  toDto(u: User) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isGuest: u.isGuest,
      plan: this.isPro(u) ? ('PRO' as const) : ('FREE' as const),
      planExpiresAt: u.planExpiresAt?.toISOString() ?? null,
      credits: u.credits,
      dailyFreeRemaining: this.freeRemaining(u),
      locale: u.locale === 'en' ? 'en' : 'tr',
      createdAt: u.createdAt.toISOString(),
    };
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError(404, 'not_found', 'Kullanıcı bulunamadı');
    return user;
  }

  /**
   * BUS / RES-01: the user row is locked for the whole decision, so two concurrent generations can't
   * both spend the last free slot or credit.
   */
  async charge(userId: string, units: number, refId: string): Promise<Charge> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<QuotaRow[]>`
        SELECT "plan", "planExpiresAt", "credits", "freeUsedOn", "freeUsedCount"
        FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const u = rows[0];
      if (!u) throw new AppError(404, 'not_found', 'Kullanıcı bulunamadı');
      const day = todayInIstanbul();
      const used = u.freeUsedOn === day ? u.freeUsedCount : 0;
      const fromFree = Math.min(units, Math.max(0, this.dailyLimit(u) - used));
      const fromCredits = units - fromFree;
      if (fromCredits > u.credits) {
        throw new AppError(402, 'insufficient_credits', 'Günlük ücretsiz hakkın ve kredin bitti');
      }
      await tx.user.update({
        where: { id: userId },
        data: { freeUsedOn: day, freeUsedCount: used + fromFree, credits: { decrement: fromCredits } },
      });
      const entries = [
        fromFree && { userId, delta: -fromFree, reason: 'daily_free', refId },
        fromCredits && { userId, delta: -fromCredits, reason: 'generation', refId },
      ].filter(Boolean) as Array<{ userId: string; delta: number; reason: string; refId: string }>;
      if (entries.length) await tx.creditLedger.createMany({ data: entries });
      return { day, fromFree, fromCredits };
    });
  }

  async refund(userId: string, charge: Charge, refId: string) {
    if (!charge.fromFree && !charge.fromCredits) return;
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<QuotaRow[]>`
        SELECT "plan", "planExpiresAt", "credits", "freeUsedOn", "freeUsedCount"
        FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const u = rows[0];
      if (!u) return;
      const sameDay = u.freeUsedOn === charge.day;
      await tx.user.update({
        where: { id: userId },
        data: {
          credits: { increment: charge.fromCredits },
          ...(sameDay ? { freeUsedCount: Math.max(0, u.freeUsedCount - charge.fromFree) } : {}),
        },
      });
      await tx.creditLedger.create({
        data: { userId, delta: charge.fromFree + charge.fromCredits, reason: 'refund', refId },
      });
    });
  }
}
