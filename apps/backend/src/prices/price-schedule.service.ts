import { Injectable } from '@nestjs/common';
import { AuditService } from '../admin/audit.service.js';
import { PlansService } from '../billing/plans.service.js';
import { ProductCatalogService, type SetPriceResult } from '../catalog/product.service.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import type { PriceSchedule } from '../generated/prisma/client.js';
import { isUuid } from '../images/images.service.js';
import { maxValue, overlaps, windowError, type CreateSchedule, type Kind } from './price-schedule.rules.js';

// Scheduled price changes (API.md §7.36). Created and cancelled by the admin; started and ended by `due()`, which the
// maintenance worker runs every minute. Each step claims its row with a conditional update first, so a step never
// runs twice even if two runs overlap (BUS-02). Starts and ends are audited with no actor (the system) (LOG-01).

const LOCK = 'price-schedule';

@Injectable()
export class PriceScheduleService {
  constructor(private prisma: PrismaService, private product: ProductCatalogService, private plans: PlansService, private audit: AuditService) {}

  /** What can be scheduled, with today's values. */
  async targets() {
    const tools = this.product.current.tools.map((t) => ({ kind: 'tool' as const, key: t.id, label: t.nameTr, value: t.credits, max: maxValue('tool'), active: t.enabled }));
    const packs = (await this.plans.packs()).map((p) => ({ kind: 'pack' as const, key: p.key, label: p.nameTr, value: p.credits, max: maxValue('pack'), active: p.active }));
    return [...tools, ...packs];
  }

  async list() {
    const [open, closed, targets] = await Promise.all([
      this.prisma.priceSchedule.findMany({ where: { status: { in: ['SCHEDULED', 'ACTIVE'] } }, orderBy: { startsAt: 'asc' } }),
      this.prisma.priceSchedule.findMany({ where: { status: { in: ['DONE', 'CANCELLED', 'FAILED'] } }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.targets(),
    ]);
    const rows = [...open, ...closed];
    const ids = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    const who = new Map((ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : []).map((u) => [u.id, u.name ?? u.email]));
    const label = new Map(targets.map((t) => [`${t.kind}:${t.key}`, t]));
    return {
      targets,
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        key: r.targetKey,
        label: label.get(`${r.kind}:${r.targetKey}`)?.label ?? r.targetKey,
        current: label.get(`${r.kind}:${r.targetKey}`)?.value ?? null,
        value: r.value,
        previousValue: r.previousValue,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt?.toISOString() ?? null,
        status: r.status,
        note: r.note,
        outcome: r.outcome,
        createdBy: r.createdById ? (who.get(r.createdById) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        appliedAt: r.appliedAt?.toISOString() ?? null,
        endedAt: r.endedAt?.toISOString() ?? null,
      })),
    };
  }

  async create(input: CreateSchedule, actorId: string, now = new Date()) {
    const kind = input.kind as Kind;
    const startsAt = new Date(input.startsAt);
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    const bad = windowError(startsAt, endsAt, now);
    if (bad) throw new AppError(400, 'bad_window', bad);
    const target = (await this.targets()).find((t) => t.kind === kind && t.key === input.key);
    if (!target) throw new AppError(400, 'unknown_target', 'Böyle bir araç ya da paket yok.');
    if (input.value > target.max) throw new AppError(400, 'value_too_high', `En çok ${target.max} olabilir.`);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${LOCK}))) AS l`;
      const open = await tx.priceSchedule.findMany({ where: { kind, targetKey: input.key, status: { in: ['SCHEDULED', 'ACTIVE'] } } });
      const clash = open.find((o) => overlaps(o, { startsAt, endsAt }));
      if (clash) throw new AppError(409, 'overlap', 'Bu araç ya da paket için o aralıkta başka bir planlı değişiklik var.');
      return tx.priceSchedule.create({ data: { kind, targetKey: input.key, value: input.value, startsAt, endsAt, note: input.reason, createdById: actorId } });
    });
  }

  /** Not started yet: cancelled. Running: ended now (the old value comes back if nobody changed it by hand). */
  async cancel(id: string) {
    if (!isUuid(id)) throw notFound();
    const cancelled = await this.prisma.priceSchedule.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'CANCELLED', endedAt: new Date(), outcome: 'Başlamadan iptal edildi.' } });
    if (cancelled.count) return { id, result: 'cancelled' as const };
    const s = await this.prisma.priceSchedule.findUnique({ where: { id } });
    if (!s) throw notFound();
    if (s.status === 'ACTIVE' && (await this.end(s, 'Elle erken bitirildi.'))) return { id, result: 'ended' as const };
    throw new AppError(409, 'not_open', 'Bu değişiklik zaten bitti ya da iptal edildi.');
  }

  /** The minute job: start what is due, end what has run its course. */
  async due(now = new Date()) {
    const out = { started: 0, ended: 0, failed: 0 };
    const toStart = await this.prisma.priceSchedule.findMany({ where: { status: 'SCHEDULED', startsAt: { lte: now } }, orderBy: { startsAt: 'asc' }, take: 50 });
    for (const s of toStart) {
      const r = await this.start(s);
      if (r === 'started') out.started++;
      else if (r === 'failed') out.failed++;
    }
    const toEnd = await this.prisma.priceSchedule.findMany({ where: { status: 'ACTIVE', endsAt: { lte: now } }, orderBy: { endsAt: 'asc' }, take: 50 });
    for (const s of toEnd) if (await this.end(s, null)) out.ended++;
    if (out.started || out.ended || out.failed) log.info('price_schedules_due', out);
    return out;
  }

  private set(s: PriceSchedule, value: number, onlyIf: number | null): Promise<SetPriceResult> {
    return s.kind === 'tool' ? this.product.setToolCredits(s.targetKey, value, onlyIf, s.createdById) : this.plans.setPackCredits(s.targetKey, value, onlyIf, s.createdById);
  }

  private async start(s: PriceSchedule): Promise<'started' | 'failed' | 'skipped'> {
    // Claim: only one run moves a schedule out of SCHEDULED.
    const claimed = await this.prisma.priceSchedule.updateMany({ where: { id: s.id, status: 'SCHEDULED' }, data: { status: 'ACTIVE', appliedAt: new Date() } });
    if (!claimed.count) return 'skipped';
    const r = await this.set(s, s.value, null);
    if (r.status !== 'ok') {
      await this.prisma.priceSchedule.update({ where: { id: s.id }, data: { status: 'FAILED', endedAt: new Date(), outcome: 'Araç ya da paket artık katalogda yok.' } });
      await this.audit.record(null, 'price_schedule.failed', 'price_schedule', s.id, { kind: s.kind, key: s.targetKey });
      return 'failed';
    }
    const permanent = s.endsAt === null;
    await this.prisma.priceSchedule.update({
      where: { id: s.id },
      data: { previousValue: r.before, ...(permanent ? { status: 'DONE', endedAt: new Date(), outcome: 'Kalıcı değişiklik uygulandı.' } : {}) },
    });
    await this.audit.record(null, 'price_schedule.start', 'price_schedule', s.id, { kind: s.kind, key: s.targetKey, from: r.before, to: s.value, permanent });
    return 'started';
  }

  /** Puts the old value back unless someone changed it by hand meanwhile; true when this call ended the schedule. */
  private async end(s: PriceSchedule, reason: string | null): Promise<boolean> {
    const claimed = await this.prisma.priceSchedule.updateMany({ where: { id: s.id, status: 'ACTIVE' }, data: { status: 'DONE', endedAt: new Date() } });
    if (!claimed.count) return false;
    let outcome: string;
    if (s.previousValue === null) outcome = 'Eski değer bilinmiyor; değer olduğu gibi bırakıldı.';
    else {
      const r = await this.set(s, s.previousValue, s.value);
      outcome =
        r.status === 'ok' ? `Eski değere (${s.previousValue}) dönüldü.`
        : r.status === 'changed' ? `Değer bu arada elle ${r.current} yapılmış; dokunulmadı.`
        : 'Araç ya da paket artık katalogda yok.';
    }
    if (reason) outcome = `${reason} ${outcome}`;
    await this.prisma.priceSchedule.update({ where: { id: s.id }, data: { outcome: outcome.slice(0, 200) } });
    await this.audit.record(null, 'price_schedule.end', 'price_schedule', s.id, { kind: s.kind, key: s.targetKey, outcome });
    return true;
  }
}
