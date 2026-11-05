import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { AppError } from '../common/errors.js';
import { log } from '../common/log.js';
import type { AiUsageReport } from '../usage/usage.service.js';

/** AI failure with the AI service's retry hint (docs/API.md §7.4); the queue retries only retryable ones. */
export class AiError extends AppError {
  constructor(status: number, code: string, message: string, public retryable: boolean, public usage?: AiUsageReport) {
    super(status, code, message);
  }
}

export interface QualityReport {
  score: number;
  issues: Array<'too_dark' | 'too_bright' | 'blurry' | 'low_res' | 'low_contrast'>;
}

// NET-04: the AI service is internal-only; every call carries the shared internal token.

export interface GenerateInput {
  tool: string;
  image_b64: string;
  variants: number;
  style_prompt?: string;
  room?: string;
  floor?: string;
  color_hex?: string;
  color_name?: string;
  target?: string;
  replacement?: string;
  instructions?: string;
  remove_all?: boolean;
  reference_image_b64?: string;
  /** Tap selection, 0..1 from the top-left; one object per point (API.md §7.15). */
  points?: Array<{ x: number; y: number }>;
  /** The panel's active prompt templates, key → text (API.md §7.26); absent keys use the service's defaults. */
  prompt_templates?: Record<string, string>;
}

/** Image prompt templates as the AI service defines them (API.md §7.26). */
export interface PromptCatalog {
  templates: Array<{ key: string; tool: string; default: string; placeholders: string[]; required: string[] }>;
  placeholders: Record<string, string>;
}

export interface SegmentOutput {
  /** PNG, grayscale, source size: 255 inside the selection. */
  mask_b64: string;
  coverage: number;
  method: 'sam3' | 'heuristic';
  usage?: AiUsageReport;
}

export interface GenerateOutput {
  images_b64: string[];
  prompt: string;
  provider: string;
  reference_style: string | null;
  /** Region lock (API.md §7.8); null for whole-scene tools. */
  region?: { applied: boolean; target: string; method: 'sam3' | 'heuristic' | 'none'; coverage: number; reason: string | null } | null;
  usage?: AiUsageReport;
}

export interface AnalyzeOutput {
  summary: string;
  palette: string[];
  items: Array<{
    name: string; category: string; material: string; color: string; quantity: number;
    price_min_try: number; price_max_try: number; search_query: string;
  }>;
  renovation: Array<{ task: string; unit: string; quantity: number; cost_min_try: number; cost_max_try: number }>;
  disclaimer: string;
  usage?: AiUsageReport;
}

export interface AsoOutput {
  listing: {
    app_name: string; app_subtitle: string; app_keywords: string; app_promo: string; app_description: string;
    app_whats_new: string; play_title: string; play_short: string; play_description: string;
  };
  /** Fields still over the store limit after the AI service's one rewrite. */
  violations: string[];
  usage?: AiUsageReport;
}

export interface SocialOutput {
  post: { title: string; caption: string; hashtags: string[]; alt_text: string };
  violations: string[];
  usage?: AiUsageReport;
}

export interface CampaignOutput {
  message: { title: string; body: string; link: string | null };
  violations: string[];
  usage?: AiUsageReport;
}

export interface ReportOutput {
  report: { summary: string; highlights: string[]; actions: string[] };
  usage?: AiUsageReport;
}

export interface BlogOutput {
  article: { title: string; description: string; slug: string; body: string };
  violations: string[];
  usage?: AiUsageReport;
}

export interface SeoOutput {
  pages: Array<{ key: string; title: string; description: string }>;
  violations: string[];
  usage?: AiUsageReport;
}

export interface ChatOutput {
  reply: string;
  suggestions: Array<{ label: string; tool: string; style_id?: string | null; room_id?: string | null; instructions?: string | null }>;
  usage?: AiUsageReport;
}

@Injectable()
export class AiClient {
  constructor(@Inject(CONFIG) private cfg: Config) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 150_000, requestId?: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.AI_SERVICE_URL}${path}`, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'content-type': 'application/json',
          'x-internal-token': this.cfg.AI_INTERNAL_TOKEN,
          ...(requestId ? { 'x-request-id': requestId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      log.warn('ai_unreachable', { path, error: (e as Error).name });
      throw new AiError(502, 'ai_unavailable', 'Yapay zekâ servisine ulaşılamadı', true);
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { code?: string; retryable?: boolean }; usage?: AiUsageReport } | null;
      const code = err?.error?.code ?? 'unknown';
      log.warn('ai_error', { path, status: res.status, code });
      if (res.status === 422 && code === 'no_change') {
        throw new AiError(422, 'no_change', 'Yapay zekâ görselde değişiklik üretemedi; hakkın iade edildi', false, err?.usage);
      }
      if (res.status === 422 && code === 'selection_failed') {
        throw new AiError(422, 'selection_failed', 'Dokunduğun yerde değiştirilecek bir nesne bulunamadı; başka bir noktaya dokun', false, err?.usage);
      }
      if (res.status === 503 && code === 'selection_unavailable') {
        throw new AiError(503, 'selection_unavailable', 'Dokunarak seçim şu an kullanılamıyor; nesnenin adını yazarak seç', false);
      }
      if (res.status === 400 || res.status === 415) throw new AiError(400, 'bad_request', 'Görsel işlenemedi', false);
      throw new AiError(502, 'ai_unavailable', 'Yapay zekâ şu an yanıt veremiyor', err?.error?.retryable ?? res.status >= 500);
    }
    return (await res.json()) as T;
  }

  generate(input: GenerateInput, requestId?: string) {
    return this.call<GenerateOutput>('POST', '/internal/v1/generate', input, 180_000, requestId);
  }

  promptCatalog() {
    return this.call<PromptCatalog>('GET', '/internal/v1/prompts', undefined, 10_000);
  }

  /** Validates a template and renders it with sample values; no image, no cost. */
  previewPrompt(input: { key: string; template: string; keep?: string }) {
    return this.call<{ prompt: string | null; errors: string[] }>('POST', '/internal/v1/prompts/preview', input, 10_000);
  }

  /** Selection preview: the mask the region lock will use for these taps (or this object name). */
  segment(input: { image_b64: string; target?: string; points?: Array<{ x: number; y: number }> }, requestId?: string) {
    return this.call<SegmentOutput>('POST', '/internal/v1/segment', input, 40_000, requestId);
  }

  analyze(input: { image_b64: string; locale: string; room?: string; style_name?: string }, requestId?: string) {
    return this.call<AnalyzeOutput>('POST', '/internal/v1/analyze', input, 120_000, requestId);
  }

  chat(input: unknown, requestId?: string) {
    return this.call<ChatOutput>('POST', '/internal/v1/chat', input, 90_000, requestId);
  }

  /** Store listing draft for one language (API.md §7.18); up to two Claude calls, hence the long timeout. */
  marketingAso(input: { locale: string; facts: string; brief?: string; whats_new?: string }) {
    return this.call<AsoOutput>('POST', '/internal/v1/marketing/aso', input, 300_000);
  }

  marketingSocial(input: { locale: string; platform: string; style_name: string; style_description: string; facts: string; brief?: string }) {
    return this.call<SocialOutput>('POST', '/internal/v1/marketing/social', input, 120_000);
  }

  marketingCampaign(input: { locale: string; channel: string; kind: string; goal: string; facts: string; links: string[] }) {
    return this.call<CampaignOutput>('POST', '/internal/v1/marketing/campaign', input, 120_000);
  }

  marketingReport(input: { metrics: string }) {
    return this.call<ReportOutput>('POST', '/internal/v1/marketing/report', input, 120_000);
  }

  marketingBlog(input: {
    locale: string; facts: string; topic?: string; keywords?: string; links: string[];
    source?: { title: string; description: string; body: string };
  }) {
    return this.call<BlogOutput>('POST', '/internal/v1/marketing/blog', input, 240_000);
  }

  marketingSeo(input: { locale: string; facts: string; pages: Array<{ key: string; path: string; purpose: string }> }) {
    return this.call<SeoOutput>('POST', '/internal/v1/marketing/seo', input, 120_000);
  }

  /** Advisory capture-quality check; failures are swallowed (never blocks an upload). */
  async quality(image_b64: string, requestId?: string): Promise<QualityReport | null> {
    try {
      const q = await this.call<QualityReport>('POST', '/internal/v1/quality', { image_b64 }, 10_000, requestId);
      return { score: q.score, issues: q.issues };
    } catch {
      return null;
    }
  }

  async health(): Promise<{ status: 'ok' | 'down'; provider: string; chatEnabled: boolean; latencyMs: number | null }> {
    const started = Date.now();
    try {
      const h = await this.call<{ provider: string; chat_enabled: boolean }>('GET', '/internal/v1/health', undefined, 5_000);
      return { status: 'ok', provider: h.provider, chatEnabled: h.chat_enabled, latencyMs: Date.now() - started };
    } catch {
      return { status: 'down', provider: 'unknown', chatEnabled: false, latencyMs: null };
    }
  }
}
