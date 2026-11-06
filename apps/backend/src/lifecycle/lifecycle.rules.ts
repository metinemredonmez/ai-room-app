import { z } from 'zod';
import { LINK_RE } from '../broadcasts/broadcast.rules.js';

// Lifecycle e-mails (API.md §7.48; fal-app, Yedi Oda #67 D+3/D+7/D+14). Three steps, each switched on and written in
// the admin, all off until someone switches them on:
//   onboarding   — signed up `afterDays` ago and has no finished design yet → "make your first design"
//   firstResult  — signed up `afterDays` ago and has exactly one finished design → "try another style / tool"
//   inactive     — not seen for `inactiveDays` → "come back", at most once per `cooldownDays`
// Commercial e-mail (ETK / İYS): only people with a current marketing consent, always with an unsubscribe link, never
// in the quiet hours, inside the shared daily e-mail cap, and never two lifecycle mails within MIN_GAP_DAYS.

export const LIFECYCLE_RULES = ['onboarding', 'firstResult', 'inactive'] as const;
export type LifecycleRule = (typeof LIFECYCLE_RULES)[number];

/** A one-off step only counts people who reached it within this many days, so switching a rule on does not mail
 *  everyone who signed up months ago. */
export const WINDOW_DAYS = 7;
/** A dormant account is mailed only while it is within this many days past the threshold. */
export const INACTIVE_WINDOW_DAYS = 60;
export const MIN_GAP_DAYS = 3;
export const SUBJECT_MAX = 80;
export const BODY_MAX = 2000;

const Pair = (max: number) => z.object({ tr: z.string().trim().min(1).max(max), en: z.string().trim().min(1).max(max) }).strict();
const Copy = {
  subject: Pair(SUBJECT_MAX),
  body: Pair(BODY_MAX),
  link: z.string().regex(LINK_RE, 'Yalnız uygulama içi bir bağlantı').nullable(),
};

export const LifecycleSettingsSchema = z
  .object({
    onboarding: z.object({ enabled: z.boolean(), afterDays: z.number().int().min(1).max(14), ...Copy }).strict(),
    firstResult: z.object({ enabled: z.boolean(), afterDays: z.number().int().min(2).max(30), ...Copy }).strict(),
    inactive: z
      .object({ enabled: z.boolean(), inactiveDays: z.number().int().min(7).max(180), cooldownDays: z.number().int().min(30).max(365), ...Copy })
      .strict(),
    /** Mails per hourly round (one a second), so a round never holds the maintenance queue for long. */
    perRun: z.number().int().min(1).max(200),
  })
  .strict();
export type LifecycleSettings = z.infer<typeof LifecycleSettingsSchema>;

export const DEFAULT_LIFECYCLE: LifecycleSettings = {
  onboarding: {
    enabled: false,
    afterDays: 2,
    subject: { tr: 'İlk tasarımın seni bekliyor', en: 'Your first design is waiting' },
    body: {
      tr: 'Merhaba,\n\nCasalume hesabını açtın ama henüz bir tasarım yapmadın. Odanın bir fotoğrafını yükle, bir stil seç; birkaç saniyede yeni hâlini gör.\n\nİpucu: Gün ışığında, odanın tamamını gösteren bir fotoğraf en iyi sonucu verir.',
      en: 'Hi,\n\nYou opened a Casalume account but have not made a design yet. Upload a photo of your room, pick a style and see it redesigned in seconds.\n\nTip: a daylight photo that shows the whole room gives the best result.',
    },
    link: '/studio',
  },
  firstResult: {
    enabled: false,
    afterDays: 5,
    subject: { tr: 'Aynı odayı başka bir stille gör', en: 'See the same room in another style' },
    body: {
      tr: 'Merhaba,\n\nİlk tasarımını yaptın, harika! Aynı fotoğrafı başka bir stille dene ya da yalnız bir nesneyi seçip değiştir: koltuğu, halıyı, perdeyi.',
      en: 'Hi,\n\nYou made your first design, great! Try the same photo in another style, or select a single object and change only that: the sofa, the rug, the curtains.',
    },
    link: '/studio',
  },
  inactive: {
    enabled: false,
    inactiveDays: 21,
    cooldownDays: 90,
    subject: { tr: 'Casalume’de yeni neler var', en: 'What’s new at Casalume' },
    body: {
      tr: 'Merhaba,\n\nBir süredir görüşemedik. Bu arada yeni stiller ve araçlar ekledik. Bir odanı yeniden tasarlamak için birkaç saniye yeter.',
      en: 'Hi,\n\nIt has been a while. We have added new styles and tools since then. Redesigning a room takes just a few seconds.',
    },
    link: '/studio',
  },
  perRun: 50,
};

/** Stored row → settings; a rule added later takes its default, junk falls back to all off. */
export function parseLifecycle(value: unknown): { settings: LifecycleSettings; ok: boolean } {
  if (value === undefined || value === null) return { settings: DEFAULT_LIFECYCLE, ok: true };
  if (typeof value !== 'object' || Array.isArray(value)) return { settings: DEFAULT_LIFECYCLE, ok: false };
  const r = LifecycleSettingsSchema.safeParse({ ...DEFAULT_LIFECYCLE, ...(value as Record<string, unknown>) });
  return r.success ? { settings: r.data, ok: true } : { settings: DEFAULT_LIFECYCLE, ok: false };
}

const DAY = 86_400_000;

/** Signed-up window for a one-off step: from `afterDays + WINDOW_DAYS` days ago up to `afterDays` days ago. */
export function signupWindow(afterDays: number, now = Date.now()) {
  return { from: new Date(now - (afterDays + WINDOW_DAYS) * DAY), until: new Date(now - afterDays * DAY) };
}

/** Last-seen window for the win-back step. */
export function inactiveWindow(inactiveDays: number, now = Date.now()) {
  return { from: new Date(now - (inactiveDays + INACTIVE_WINDOW_DAYS) * DAY), until: new Date(now - inactiveDays * DAY) };
}

/** One-off steps are keyed once per person; the win-back step by the day it went out (its cooldown is checked apart). */
export const periodKey = (rule: LifecycleRule, istanbulDay: string) => (rule === 'inactive' ? istanbulDay : 'once');

/** Audit summary: which rules and numbers changed, and that texts changed — never the texts themselves. */
export function lifecycleDiff(prev: LifecycleSettings, next: LifecycleSettings): string[] {
  const out: string[] = [];
  for (const r of LIFECYCLE_RULES) {
    const a = prev[r] as Record<string, unknown>;
    const b = next[r] as Record<string, unknown>;
    for (const k of Object.keys(b)) {
      if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
      out.push(k === 'subject' || k === 'body' ? `${r}.${k}: metin değişti` : `${r}.${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
    }
  }
  if (prev.perRun !== next.perRun) out.push(`perRun: ${prev.perRun} → ${next.perRun}`);
  return out;
}
