import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { AppError } from '../common/errors.js';
import { log } from '../common/log.js';

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
}

export interface GenerateOutput {
  images_b64: string[];
  prompt: string;
  provider: string;
  reference_style: string | null;
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
}

export interface ChatOutput {
  reply: string;
  suggestions: Array<{ label: string; tool: string; style_id?: string | null; room_id?: string | null; instructions?: string | null }>;
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
      throw new AppError(502, 'ai_unavailable', 'Yapay zekâ servisine ulaşılamadı');
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      const code = err?.error?.code ?? 'unknown';
      log.warn('ai_error', { path, status: res.status, code });
      if (res.status === 400 || res.status === 415) throw new AppError(400, 'bad_request', 'Görsel işlenemedi');
      throw new AppError(502, 'ai_unavailable', 'Yapay zekâ şu an yanıt veremiyor');
    }
    return (await res.json()) as T;
  }

  generate(input: GenerateInput, requestId?: string) {
    return this.call<GenerateOutput>('POST', '/internal/v1/generate', input, 180_000, requestId);
  }

  analyze(input: { image_b64: string; locale: string; room?: string; style_name?: string }, requestId?: string) {
    return this.call<AnalyzeOutput>('POST', '/internal/v1/analyze', input, 120_000, requestId);
  }

  chat(input: unknown, requestId?: string) {
    return this.call<ChatOutput>('POST', '/internal/v1/chat', input, 90_000, requestId);
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
