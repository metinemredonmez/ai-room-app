import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { LOCALES } from '../catalog/catalog.data.js';

// Swagger/OpenAPI docs are generated from the same zod schemas that validate requests, so the docs
// can't drift from what the API actually accepts. Response shapes mirror docs/API.md.

type SchemaObject = Record<string, unknown>;

export function jsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'input'): SchemaObject {
  const out = z.toJSONSchema(schema, { target: 'openapi-3.0', io, unrepresentable: 'any' }) as SchemaObject;
  delete out.$schema;
  return out;
}

const ERRORS: Record<number, string> = {
  400: 'validation_failed / bad_request / invalid_token',
  401: 'unauthorized',
  402: 'insufficient_credits / pro_required',
  403: 'forbidden / consent_required',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'no_change',
  429: 'rate_limited (Retry-After başlığı)',
  502: 'ai_unavailable',
  503: 'busy / generation_paused',
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

export function Doc(
  summary: string,
  opts: { body?: z.ZodType; status?: number; response?: string | SchemaObject; description?: string; errors?: number[]; produces?: string } = {},
) {
  const decorators = [ApiOperation({ summary, description: opts.description })];
  if (opts.body) decorators.push(ApiBody({ schema: jsonSchema(opts.body) as never }));
  const schema = typeof opts.response === 'string' ? ref(opts.response) : opts.response;
  decorators.push(
    ApiResponse({
      status: opts.status ?? 200,
      description: opts.produces ?? 'OK',
      ...(schema ? { schema: schema as never } : {}),
    }),
  );
  for (const code of opts.errors ?? []) decorators.push(ApiResponse({ status: code, description: ERRORS[code], schema: ref('Error') as never }));
  return applyDecorators(...decorators);
}

// ------------------------------------------------------------------------------- response models

const iso = z.string().describe('ISO-8601');
const ImageRef = z.object({ id: z.uuid(), url: z.url().describe('İmzalı, 24 saat geçerli'), width: z.number(), height: z.number() });
const User = z.object({
  id: z.uuid(), email: z.string().nullable(), emailVerified: z.boolean(), name: z.string().nullable(),
  role: z.enum(['USER', 'SUPPORT', 'EDITOR', 'ADMIN', 'SUPER_ADMIN']), isGuest: z.boolean(), plan: z.enum(['FREE', 'PRO']), planExpiresAt: iso.nullable(),
  credits: z.number(), dailyFreeRemaining: z.number(), locale: z.enum(LOCALES), createdAt: iso,
});
const Design = z.object({
  id: z.uuid(), title: z.string(), tool: z.string(), styleId: z.string().nullable(), roomId: z.string().nullable(),
  params: z.record(z.string(), z.unknown()), status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']), error: z.string().nullable(),
  input: ImageRef, results: z.array(ImageRef), favorite: z.boolean(), featured: z.boolean(),
  chargeState: z.enum(['HELD', 'CAPTURED', 'RELEASED']).nullable(),
  region: z.object({
    applied: z.boolean().describe('true: pixels outside the mask are the input photo (API.md §7.8)'),
    target: z.string(), method: z.enum(['sam3', 'heuristic', 'none']), coverage: z.number().min(0).max(1),
    reason: z.enum(['no_segmenter', 'segmentation_failed', 'mask_unusable']).nullable(),
  }).nullable().describe('Region lock for paint / flooring / replace / targeted declutter; null otherwise'),
  queuedAt: iso.nullable(), startedAt: iso.nullable(), createdAt: iso,
});
const Money = z.number().describe('TL');
const Analysis = z.object({
  id: z.uuid(), designId: z.uuid(), imageId: z.uuid(), summary: z.string(), palette: z.array(z.string()),
  items: z.array(z.object({
    name: z.string(), category: z.string(), material: z.string(), color: z.string(), quantity: z.number(),
    priceMinTRY: Money, priceMaxTRY: Money, links: z.array(z.object({ store: z.string(), url: z.url() })),
  })),
  renovation: z.array(z.object({ task: z.string(), unit: z.string(), quantity: z.number(), costMinTRY: Money, costMaxTRY: Money })),
  totals: z.object({
    furnitureMinTRY: Money, furnitureMaxTRY: Money, renovationMinTRY: Money, renovationMaxTRY: Money, grandMinTRY: Money, grandMaxTRY: Money,
  }),
  disclaimer: z.string(), createdAt: iso,
});
const Quality = z.object({ score: z.number().min(0).max(100), issues: z.array(z.enum(['too_dark', 'too_bright', 'blurry', 'low_res', 'low_contrast'])) });

export const COMPONENTS: Record<string, SchemaObject> = Object.fromEntries(
  Object.entries({
    Error: z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
    ImageRef,
    User,
    AuthResponse: z.object({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.number(), user: User }),
    Design,
    DesignPage: z.object({ items: z.array(Design), nextCursor: z.string().nullable() }),
    Analysis,
    Upload: z.object({ image: ImageRef, quality: Quality.nullable().describe('Tavsiye niteliğinde; AI servisi yanıt vermezse null') }),
    Selection: z.object({
      mask: z.string().describe('data:image/png;base64,… — gri tonlu, fotoğrafla aynı boyutta; seçili alan 255'),
      coverage: z.number().min(0).max(1).describe('Seçimin fotoğraftaki payı'),
      method: z.enum(['sam3', 'heuristic']).describe('heuristic: yalnız demo (mock) modunda'),
    }),
    Catalog: z.object({
      tools: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), icon: z.string(), category: z.string(), isPro: z.boolean(), isNew: z.boolean(), needs: z.record(z.string(), z.boolean()) })),
      styles: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), palette: z.array(z.string()), isPro: z.boolean(), previewUrl: z.url() })),
      rooms: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string() })),
      floors: z.array(z.object({ id: z.string(), name: z.string() })),
      colors: z.array(z.object({ id: z.string(), name: z.string(), hex: z.string() })),
      plans: z.array(z.object({ id: z.string(), name: z.string(), period: z.enum(['week', 'month', 'year']), priceTRY: z.number(), badge: z.string().nullable() })),
      announcement: z.string().nullable(),
      maintenance: z.object({ enabled: z.boolean(), message: z.string() }),
      legal: z.object({ termsVersion: z.string(), privacyVersion: z.string(), aiProcessingVersion: z.string(), marketingVersion: z.string() }),
      features: z.record(z.string(), z.boolean()).describe('Özellik bayrakları (API.md §7.28); okunamayan bayrak kapalı sayılır'),
    }),
    Features: z.object({ features: z.record(z.string(), z.boolean()).describe('assistant_chat, cost_analysis, tap_selection, support_tickets, guest_mode, signup, blog') }),
    ChatReply: z.object({
      reply: z.string(),
      suggestions: z.array(z.object({ label: z.string(), tool: z.string(), styleId: z.string().optional(), roomId: z.string().optional(), instructions: z.string().optional() })),
    }),
    Ok: z.object({ ok: z.literal(true) }),
  }).map(([name, schema]) => [name, jsonSchema(schema, 'output')]),
);
