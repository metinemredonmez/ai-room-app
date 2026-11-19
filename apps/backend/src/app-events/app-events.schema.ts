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

export const TrackEventBody = z.object({
  name: z.enum(APP_EVENT_NAMES),
  platform: z.enum(['web', 'ios', 'android']).optional(),
  version: z.string().max(20).optional(),
  sessionId: z.string().max(64).optional(),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export const FunnelQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
