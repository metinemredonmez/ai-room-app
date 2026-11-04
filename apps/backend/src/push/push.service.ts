import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG, type Config } from '../config.js';
import type { Locale } from '../catalog/catalog.data.js';
import type { Design } from '../generated/prisma/client.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';
const CHUNK = 100; // Expo accepts at most 100 messages / 1000 receipt ids per request
const MAX_TOKENS_PER_USER = 10;

/** Expo push tokens only; anything else is rejected before it reaches the database. */
export const PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: 'default';
  priority: 'high';
  /** Android notification channel; the app creates `designs` and `news` (broadcasts). */
  channelId: 'designs' | 'news';
}

interface Ticket {
  status: 'ok' | 'error';
  id?: string;
  details?: { error?: string };
}

/** Thrown for 429 / 5xx / network failures so BullMQ retries the job with backoff. */
export class PushRetryableError extends Error {}

const COPY = {
  tr: {
    ready: { title: 'Tasarımın hazır', body: (t: string) => `"${t}" tamamlandı. Görmek için dokun.` },
    failed: { title: 'Tasarım oluşturulamadı', body: () => 'Hakkın iade edildi, tekrar deneyebilirsin.' },
  },
  en: {
    ready: { title: 'Your design is ready', body: (t: string) => `"${t}" is done. Tap to view it.` },
    failed: { title: "We couldn't create your design", body: () => 'Your credit was refunded. Please try again.' },
  },
} as const;

export const maskToken = (token: string) => `${token.slice(0, 18)}…${token.slice(-4)}`;

/**
 * "Tasarımın hazır" push (palemi notifications pattern, Expo Push). Development writes messages to
 * DATA_DIR/push-outbox; production sends through Expo. Tokens never reach the log (LOG-02), and an
 * Expo "DeviceNotRegistered" answer — on the ticket or the later receipt — removes the token.
 */
@Injectable()
export class PushService {
  private outbox: string;

  constructor(private prisma: PrismaService, @Inject(CONFIG) private cfg: Config) {
    this.outbox = path.resolve(cfg.DATA_DIR, 'push-outbox');
  }

  get transport() {
    return this.cfg.PUSH_TRANSPORT;
  }

  /** Upsert by token: a device that signs into another account stops receiving the old account's pushes (AZ-01). */
  async register(userId: string, token: string, platform: 'ios' | 'android') {
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastSeenAt: new Date() },
    });
    const stale = await this.prisma.pushToken.findMany({
      where: { userId }, orderBy: { lastSeenAt: 'desc' }, skip: MAX_TOKENS_PER_USER, select: { id: true },
    });
    if (stale.length) await this.prisma.pushToken.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }

  async unregister(userId: string, token: string) {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  /** Sends the result of a queued design to every device of its owner. Returns receipt ids to check later. */
  async notifyDesign(designId: string, titleOf: (d: Design, locale: Locale) => Promise<string>): Promise<Record<string, string>> {
    const design = await this.prisma.design.findUnique({
      where: { id: designId },
      include: { user: { select: { locale: true, pushTokens: { select: { token: true } } } } },
    });
    if (!design || design.status === 'PENDING' || !design.user.pushTokens.length) return {};
    const locale: Locale = design.user.locale === 'en' ? 'en' : 'tr';
    const copy = COPY[locale][design.status === 'SUCCEEDED' ? 'ready' : 'failed'];
    const title = await titleOf(design, locale);
    const messages: PushMessage[] = design.user.pushTokens.map(({ token }) => ({
      to: token,
      title: copy.title,
      body: copy.body(title),
      data: { type: 'design', designId: design.id, status: design.status, url: `casalume://design/${design.id}` },
      sound: 'default',
      priority: 'high',
      channelId: 'designs',
    }));
    const receipts = await this.send(messages);
    log.info('push_sent', { designId, status: design.status, devices: messages.length, transport: this.transport });
    return receipts;
  }

  async send(messages: PushMessage[]): Promise<Record<string, string>> {
    if (this.cfg.PUSH_TRANSPORT === 'outbox') {
      await mkdir(this.outbox, { recursive: true, mode: 0o700 });
      for (const m of messages) {
        const file = path.join(this.outbox, `${Date.now()}-${randomUUID()}.json`);
        await writeFile(file, JSON.stringify({ ...m, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
      }
      return {};
    }
    const receipts: Record<string, string> = {};
    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk = messages.slice(i, i + CHUNK);
      const tickets = await this.post<Ticket[]>(EXPO_SEND, chunk);
      Object.assign(receipts, await this.handleTickets(chunk.map((m) => m.to), tickets));
    }
    return receipts;
  }

  /** Ticket i belongs to message i. Dead devices are removed now; the rest are checked via receipts. */
  async handleTickets(tokens: string[], tickets: Ticket[]): Promise<Record<string, string>> {
    const dead: string[] = [];
    const receipts: Record<string, string> = {};
    tickets.forEach((t, i) => {
      const token = tokens[i];
      if (!token) return;
      if (t.status === 'ok' && t.id) receipts[t.id] = token;
      else if (t.details?.error === 'DeviceNotRegistered') dead.push(token);
      else if (t.status === 'error') log.warn('push_ticket_error', { error: t.details?.error ?? 'unknown', token: maskToken(token) });
    });
    if (dead.length) await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
    return receipts;
  }

  /** Expo receipts (~15 min after sending) report delivery failures the ticket could not know yet. */
  async checkReceipts(map: Record<string, string>): Promise<{ checked: number; removed: number }> {
    const ids = Object.keys(map);
    const dead: string[] = [];
    for (let i = 0; i < ids.length; i += 1000) {
      const out = await this.post<Record<string, Ticket>>(EXPO_RECEIPTS, { ids: ids.slice(i, i + 1000) });
      for (const [id, r] of Object.entries(out ?? {})) {
        if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered' && map[id]) dead.push(map[id]);
        else if (r.status === 'error') log.warn('push_receipt_error', { error: r.details?.error ?? 'unknown' });
      }
    }
    if (dead.length) await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
    return { checked: ids.length, removed: dead.length };
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.cfg.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${this.cfg.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new PushRetryableError(`expo_network_${(e as Error).name}`);
    }
    if (res.status === 429 || res.status >= 500) throw new PushRetryableError(`expo_http_${res.status}`);
    const json = (await res.json().catch(() => null)) as { data?: T; errors?: { code?: string }[] } | null;
    if (!res.ok || !json?.data) {
      // 4xx: the request itself is wrong (bad token format, push security misconfigured) — retrying won't help.
      log.error('push_rejected', { status: res.status, code: json?.errors?.[0]?.code ?? 'unknown' });
      return (Array.isArray(body) ? [] : {}) as T;
    }
    return json.data;
  }
}
