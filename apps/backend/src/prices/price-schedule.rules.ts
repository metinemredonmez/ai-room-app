import { z } from 'zod';
import { MAX_TOOL_CREDITS } from '../catalog/product.rules.js';

// Scheduled price changes (API.md §7.36). What Casalume itself prices: a tool's credit cost (product catalog,
// §7.25.1) and how many credits a pack's store product grants (billing catalog, §7.21). Store prices are set in App
// Store Connect and Play Console and cannot be scheduled from here.
//
// A change starts at `startsAt` (checked every minute) and, with `endsAt`, goes back at that time — but only if the
// value is still the scheduled one, so a hand edit made in between is never undone. Two schedules for the same target
// may not overlap. Without `endsAt` the change is permanent.

export const KINDS = ['tool', 'pack'] as const;
export type Kind = (typeof KINDS)[number];
export const STATUSES = ['SCHEDULED', 'ACTIVE', 'DONE', 'CANCELLED', 'FAILED'] as const;
export type Status = (typeof STATUSES)[number];

export const MAX_PACK_CREDITS = 10_000;
const MINUTE = 60_000;
const DAY = 86_400_000;
export const LIMITS = { pastStartMs: 5 * MINUTE, maxLeadMs: 365 * DAY, minLengthMs: 15 * MINUTE, maxLengthMs: 180 * DAY } as const;

export const CreateScheduleSchema = z
  .object({
    kind: z.enum(KINDS),
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    value: z.number().int().min(1).max(MAX_PACK_CREDITS),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }).nullable(),
    reason: z.string().trim().min(3).max(200),
  })
  .strict();
export type CreateSchedule = z.infer<typeof CreateScheduleSchema>;

export const maxValue = (kind: Kind) => (kind === 'tool' ? MAX_TOOL_CREDITS : MAX_PACK_CREDITS);

/** Why a window is not acceptable (null when it is). */
export function windowError(startsAt: Date, endsAt: Date | null, now: Date): string | null {
  if (startsAt.getTime() < now.getTime() - LIMITS.pastStartMs) return 'Başlangıç geçmişte olamaz.';
  if (startsAt.getTime() > now.getTime() + LIMITS.maxLeadMs) return 'Başlangıç en çok bir yıl sonrası olabilir.';
  if (endsAt) {
    const len = endsAt.getTime() - startsAt.getTime();
    if (len < LIMITS.minLengthMs) return 'Bitiş, başlangıçtan en az 15 dakika sonra olmalı.';
    if (len > LIMITS.maxLengthMs) return 'Geçici değişiklik en çok 180 gün sürebilir; kalıcı değişiklik için bitişi boş bırak.';
  }
  return null;
}

/** [start, end) windows; a missing end is open-ended. */
export function overlaps(a: { startsAt: Date; endsAt: Date | null }, b: { startsAt: Date; endsAt: Date | null }): boolean {
  const aEnd = a.endsAt?.getTime() ?? Infinity;
  const bEnd = b.endsAt?.getTime() ?? Infinity;
  return a.startsAt.getTime() < bEnd && b.startsAt.getTime() < aEnd;
}
