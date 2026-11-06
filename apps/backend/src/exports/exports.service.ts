import { Injectable } from '@nestjs/common';
import { ipPrefix } from '../auth/client-info.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { PartnersService } from '../partners/partners.service.js';
import { toCsv } from './csv.js';

// Admin CSV exports (API.md §7.44; Palemi store-events export). Pseudonymous where possible: users appear by id, not
// by e-mail; staff in the audit export by e-mail (SUPER_ADMIN only) and their IP only as a /24 prefix.

export type ExportKind = (typeof EXPORT_KINDS)[number];
export const EXPORT_KINDS = ['billing-events', 'subscriptions', 'ai-costs', 'partners', 'audit', 'waitlist'] as const;
/** Kinds with e-mail addresses or staff activity: SUPER_ADMIN only (AZ-01). */
export const SUPER_ADMIN_EXPORTS: readonly ExportKind[] = ['audit', 'waitlist'];
export const isExportKind = (v: string): v is ExportKind => (EXPORT_KINDS as readonly string[]).includes(v);

export const MAX_ROWS = 50_000;
const MAX_DAYS = 366;
const DAY = 86_400_000;

/** `from` / `to` as Istanbul calendar days (YYYY-MM-DD, `to` inclusive); default the last 30 days. */
export function exportRange(from: string | undefined, to: string | undefined, now = new Date()) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !day.test(from)) || (to && !day.test(to))) throw new AppError(400, 'validation_failed', 'Tarih YYYY-AA-GG olmalı.');
  const end = to ? new Date(`${to}T00:00:00+03:00`).getTime() + DAY : now.getTime();
  const start = from ? new Date(`${from}T00:00:00+03:00`).getTime() : end - 30 * DAY;
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) throw new AppError(400, 'validation_failed', 'Başlangıç bitişten önce olmalı.');
  if (end - start > MAX_DAYS * DAY) throw new AppError(400, 'validation_failed', `En çok ${MAX_DAYS} günlük aralık.`);
  return { gte: new Date(start), lt: new Date(end) };
}

@Injectable()
export class ExportsService {
  constructor(private prisma: PrismaService, private partners: PartnersService) {}

  async build(kind: ExportKind, range: { gte: Date; lt: Date }): Promise<{ csv: string; rows: number; truncated: boolean }> {
    const { header, rows } = await this.rows(kind, range);
    const truncated = rows.length > MAX_ROWS;
    const kept = rows.slice(0, MAX_ROWS);
    return { csv: toCsv(header, kept), rows: kept.length, truncated };
  }

  private async rows(kind: ExportKind, range: { gte: Date; lt: Date }): Promise<{ header: string[]; rows: unknown[][] }> {
    const take = MAX_ROWS + 1;
    switch (kind) {
      case 'billing-events': {
        const events = await this.prisma.webhookEvent.findMany({ where: { source: 'revenuecat', receivedAt: range }, orderBy: { receivedAt: 'asc' }, take });
        return {
          header: ['received_at', 'type', 'product_id', 'price', 'currency', 'store', 'environment', 'status', 'user_id'],
          rows: events.map((e) => {
            const p = (e.payload ?? {}) as Record<string, unknown>;
            return [e.receivedAt, e.type, p.product_id ?? '', typeof p.price === 'number' ? p.price : '', p.currency ?? '', p.store ?? '', p.environment ?? '', e.status, e.userId ?? ''];
          }),
        };
      }
      case 'subscriptions': {
        const subs = await this.prisma.subscription.findMany({ where: { updatedAt: range }, orderBy: { updatedAt: 'asc' }, take });
        return {
          header: ['updated_at', 'user_id', 'entitlement', 'product_id', 'store', 'environment', 'period_type', 'status', 'expires_at', 'grace_until'],
          rows: subs.map((s) => [s.updatedAt, s.userId, s.entitlement, s.productId ?? '', s.store ?? '', s.environment ?? '', s.periodType ?? '', s.status, s.expiresAt ?? '', s.gracePeriodExpiresAt ?? '']),
        };
      }
      case 'ai-costs': {
        const rows = await this.prisma.$queryRaw<Array<{ day: string; provider: string; kind: string; calls: bigint; images: bigint; cost: number }>>`
          SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') AS day, provider, kind,
            COUNT(*) AS calls, COALESCE(SUM(images), 0) AS images, COALESCE(SUM("costUsd"), 0)::float8 AS cost
          FROM "AiUsage" WHERE "createdAt" >= ${range.gte} AND "createdAt" < ${range.lt}
          GROUP BY 1, 2, 3 ORDER BY 1, 2, 3 LIMIT ${take}`;
        return { header: ['day', 'provider', 'kind', 'calls', 'images', 'cost_usd'], rows: rows.map((r) => [r.day, r.provider, r.kind, Number(r.calls), Number(r.images), Number(r.cost.toFixed(6))]) };
      }
      case 'partners': {
        const { items } = await this.partners.list();
        return {
          header: ['slug', 'name', 'active', 'visits', 'visits_30d', 'signups', 'verified', 'designers', 'payers', 'revenue_usd', 'commission_pct', 'commission_usd', 'created_at'],
          rows: items.map((p) => [p.slug, p.name, p.active, p.visits, p.visits30, p.signups, p.verified, p.designers, p.payers, p.revenueUsd, p.commissionPct, p.commissionUsd, p.createdAt]),
        };
      }
      case 'waitlist': {
        // API.md §7.47: confirmed addresses only (double opt-in), with the consent text version, by confirmation date.
        const rows = await this.prisma.waitlistEntry.findMany({ where: { status: 'CONFIRMED', confirmedAt: range }, orderBy: { confirmedAt: 'asc' }, take });
        return {
          header: ['confirmed_at', 'email', 'locale', 'platforms', 'source', 'consent_version'],
          rows: rows.map((r) => [r.confirmedAt, r.email, r.locale, r.platforms.join(' '), r.source, r.consentVersion]),
        };
      }
      case 'audit': {
        const logs = await this.prisma.auditLog.findMany({ where: { createdAt: range }, orderBy: { createdAt: 'asc' }, take, include: { actor: { select: { email: true } } } });
        return {
          header: ['created_at', 'actor', 'action', 'target_type', 'target_id', 'reason', 'ip_prefix'],
          rows: logs.map((l) => {
            const meta = (l.meta ?? {}) as Record<string, unknown>;
            return [l.createdAt, l.actor?.email ?? (l.actorId ? 'silinmiş hesap' : 'sistem'), l.action, l.targetType, l.targetId ?? '', typeof meta.reason === 'string' ? meta.reason : '', l.ip ? ipPrefix(l.ip) : ''];
          }),
        };
      }
    }
  }
}
