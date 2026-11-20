import { z } from 'zod';

export const APP_EVENT_NAMES = [
  'studio_open',
  'upload_photo',
  'select_style',
  'generate_start',
  'generate_success',
  'generate_fail',
  'result_view',
  'result_share',
  'share_link_created',
  'favorite_toggle',
  'download_result',
  'pro_preview_open',
  'coach_open',
  'feedback_given',
  'login',
  'register',
  'guest_start',
] as const;

export type AppEventName = (typeof APP_EVENT_NAMES)[number];

// INP / RES-01: the endpoint is public, so every field is small and flat. `meta` holds at most 8 short facts
// (tool id, style id, a count) — no nested objects, no long text, nothing that could carry personal data in bulk.
const META_KEY = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;
const metaValue = z.union([z.string().max(80), z.number().finite(), z.boolean(), z.null()]);

export const TrackEventBody = z
  .object({
    name: z.enum(APP_EVENT_NAMES),
    platform: z.enum(['web', 'ios', 'android']).optional(),
    version: z.string().regex(/^[0-9A-Za-z.+-]{1,20}$/).optional(),
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
    meta: z
      .record(z.string().regex(META_KEY), metaValue)
      .refine((m) => Object.keys(m).length <= 8, 'en çok 8 alan')
      .default({}),
  })
  .strict();

export const FunnelQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
