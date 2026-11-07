import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';
import { AiClient, AiError, type VoiceFailure } from '../ai/ai.client.js';
import { AlertsService } from '../alerts/alerts.service.js';
import { safeEqual } from '../auth/crypto.js';
import { CONFIG, type Config } from '../config.js';
import { AppError } from '../common/errors.js';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService, RedisService } from '../common/infra.js';
import { log } from '../common/log.js';
import { createObjectStore, type ObjectStore } from '../images/object-store.js';
import { SettingsService } from '../settings/settings.service.js';
import { UsageService } from '../usage/usage.service.js';
import { UsersService } from '../users/users.service.js';
import { estimateSeconds, speechText, voiceChain, voiceLang, type CoachSettings } from './coach.rules.js';

// API.md §7.54 — the AI coach's voice and daily allowance (fal-app voice-quota / tts-storage, adapted).
//
// * The coach only reads its own replies: POST /v1/chat returns a `speakToken`, an HMAC over the user, the language and
//   the reply text; /coach/speak refuses any other text (AI-01, RES-01: no free text-to-speech for anyone).
// * The day's allowance (messages, listening seconds) is reserved before the work and given back when it fails.
// * The same reply in the same voice is synthesised once; audio lives in private storage and is served only through
//   short-lived signed URLs (AZ-01, FIL-04). No user is linked to an audio row.
// * A provider's billing or key problem reaches the founder on the first occurrence (fal-app lesson: the third).

const DAY = 86_400_000;
const REPLY_TTL_SEC = 24 * 3600;
const AUDIO_TTL_SEC = 3600;
const KEY_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^(\d{10})\.([A-Za-z0-9_-]{43})$/;

export type QuotaKind = 'messages' | 'listenSeconds';

/** A provider problem worth an alert; grouped by provider and reason, so one mail per kind of problem. */
export class CoachVoiceProblem extends Error {
  override name = 'CoachVoiceProblem';
}

export interface SpokenReply {
  url: string;
  seconds: number;
  mime: string;
  cached: boolean;
}

@Injectable()
export class CoachService {
  readonly store: ObjectStore;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private settings: SettingsService,
    private ai: AiClient,
    private usage: UsageService,
    private users: UsersService,
    private alerts: AlertsService,
    @Inject(CONFIG) private cfg: Config,
  ) {
    // Same driver as images (local disk or the private bucket), its own folder.
    this.store = createObjectStore(cfg, path.resolve(cfg.DATA_DIR));
  }

  get current(): CoachSettings {
    return this.settings.current.coach;
  }

  // ---------------------------------------------------------------------------------------------- allowance

  private qkey(kind: QuotaKind, userId: string, day = todayInIstanbul()) {
    return `coach:q:${kind}:${day}:${userId}`;
  }

  limits(pro: boolean) {
    return pro ? this.current.quota.pro : this.current.quota.free;
  }

  /** Takes `amount` from today's allowance or throws 429 `coach_quota`. Redis unavailable → 503 (fail closed). */
  async reserve(kind: QuotaKind, userId: string, amount: number, pro: boolean, locale: string): Promise<() => Promise<void>> {
    const limit = this.limits(pro)[kind];
    const key = this.qkey(kind, userId);
    let used: number;
    try {
      const res = await this.redis.client.multi().incrby(key, amount).pexpire(key, 2 * DAY).exec();
      used = Number(res?.[0]?.[1]);
    } catch {
      throw new AppError(503, 'busy', 'Servis geçici olarak meşgul');
    }
    if (!Number.isFinite(used)) throw new AppError(503, 'busy', 'Servis geçici olarak meşgul');
    const release = async () => {
      await this.redis.client.decrby(key, amount).catch((e: Error) => log.warn('coach_quota_release_failed', { error: e.name }));
    };
    if (used > limit) {
      await release();
      const text = locale === 'tr' ? this.current.limitTextTr : this.current.limitTextEn;
      throw new AppError(429, 'coach_quota', text, {}, { kind, limit, pro });
    }
    return release;
  }

  async quota(userId: string) {
    const user = await this.users.get(userId);
    const pro = this.users.isPro(user);
    const lim = this.limits(pro);
    const [m, l] = await this.redis.client
      .mget(this.qkey('messages', userId), this.qkey('listenSeconds', userId))
      .catch(() => [null, null] as Array<string | null>);
    const used = (v: string | null | undefined) => Math.max(0, Number(v ?? 0) || 0);
    return {
      plan: pro ? ('PRO' as const) : ('FREE' as const),
      messages: { used: Math.min(used(m), lim.messages), limit: lim.messages },
      listenSeconds: { used: Math.min(used(l), lim.listenSeconds), limit: lim.listenSeconds },
      voice: this.current.voice.enabled,
    };
  }

  // ---------------------------------------------------------------------------------------------- reply token

  private hmac(message: string) {
    // Same server secret as image links, a different message prefix (domain separation): no new secret to manage.
    return createHmac('sha256', this.cfg.IMAGE_URL_SECRET).update(message).digest('base64url');
  }

  private replyMessage(userId: string, locale: string, text: string, exp: number) {
    return `coach-reply:${userId}:${voiceLang(locale)}:${createHash('sha256').update(text).digest('hex')}:${exp}`;
  }

  /** Lets this user ask for this exact reply to be read aloud, for 24 hours. */
  signReply(userId: string, locale: string, text: string, now = Date.now()): string {
    const exp = Math.floor(now / 1000) + REPLY_TTL_SEC;
    return `${exp}.${this.hmac(this.replyMessage(userId, locale, text, exp))}`;
  }

  verifyReply(userId: string, locale: string, text: string, token: string, now = Date.now()): boolean {
    const m = TOKEN_RE.exec(token);
    if (!m) return false;
    const exp = Number(m[1]);
    if (exp < now / 1000) return false;
    return safeEqual(this.hmac(this.replyMessage(userId, locale, text, exp)), m[2]!);
  }

  // ---------------------------------------------------------------------------------------------- speech

  private audioKey(key: string) {
    if (!KEY_RE.test(key)) throw new AppError(404, 'not_found', 'Ses bulunamadı');
    return `coach-audio/${key}`;
  }

  audioUrl(key: string, now = Date.now()): string {
    const step = 600;
    const exp = Math.ceil(now / 1000 / step) * step + AUDIO_TTL_SEC;
    return `${this.cfg.PUBLIC_BASE_URL}/v1/coach/audio/${key}?exp=${exp}&sig=${this.hmac(`coach-audio:${key}:${exp}`)}`;
  }

  verifyAudio(key: string, exp: string | undefined, sig: string | undefined, now = Date.now()): boolean {
    if (!KEY_RE.test(key) || !exp || !sig || !/^\d{10}$/.test(exp)) return false;
    if (Number(exp) < now / 1000) return false;
    return safeEqual(this.hmac(`coach-audio:${key}:${exp}`), sig);
  }

  async readAudio(key: string): Promise<{ body: Buffer; mime: string } | null> {
    const row = await this.prisma.coachAudio.findUnique({ where: { key } });
    if (!row) return null;
    const body = await this.store.get(this.audioKey(key));
    return body ? { body, mime: row.mime } : null;
  }

  /**
   * A reply the coach gave this user, as speech. `token` comes from POST /v1/chat. Listening seconds are taken from the
   * day's allowance before anything is produced and given back if no audio comes out.
   */
  async speak(userId: string, input: { text: string; token: string; locale: string }, requestId?: string): Promise<SpokenReply> {
    const s = this.current.voice;
    if (!s.enabled) throw new AppError(503, 'voice_disabled', 'Koçun sesi şu an kapalı');
    if (!this.verifyReply(userId, input.locale, input.text, input.token)) {
      throw new AppError(403, 'speak_forbidden', 'Yalnız koçun sana verdiği cevaplar seslendirilebilir');
    }
    const text = speechText(input.text);
    if (!text) throw new AppError(400, 'validation_failed', 'Okunacak metin yok');
    const user = await this.users.get(userId);
    const pro = this.users.isPro(user);
    const chain = voiceChain(s, input.locale);
    const lang = voiceLang(input.locale);
    const seconds = estimateSeconds(text, s.elevenlabs.speed);
    const release = await this.reserve('listenSeconds', userId, seconds, pro, input.locale);
    try {
      // The cache key covers everything that changes the sound; it names the first step, which is what we cache.
      const key = createHash('sha256').update(JSON.stringify({ v: 1, lang, step: chain[0] ?? 'demo', text })).digest('hex');
      const hit = await this.prisma.coachAudio.findUnique({ where: { key } });
      if (hit && (await this.store.get(this.audioKey(key)))) {
        await this.prisma.coachAudio.update({ where: { key }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
        return { url: this.audioUrl(key), seconds: hit.seconds, mime: hit.mime, cached: true };
      }
      if (!chain.length && this.cfg.isProd) {
        void this.alert('voice', 'voice_unassigned', requestId);
        throw new AppError(503, 'voice_unassigned', 'Koçun sesi henüz seçilmedi');
      }
      await this.assertBudget(pro);
      let out;
      try {
        out = await this.ai.tts({ text, lang, chain }, requestId);
      } catch (e) {
        if (e instanceof AiError && e.failures) for (const f of e.failures) void this.alertFailure(f, requestId);
        throw e;
      }
      for (const f of out.failures) void this.alertFailure(f, requestId);
      await this.usage.record(out.usage, { userId });
      const body = Buffer.from(out.audio_b64, 'base64');
      const mime = out.mime === 'audio/wav' ? 'audio/wav' : 'audio/mpeg';
      // Only the first step's audio is cached: a fallback voice must not stick once the first provider is back.
      const cacheable = !out.failures.length && (chain[0]?.provider ?? 'demo') === out.provider;
      const storeKey = cacheable ? key : createHash('sha256').update(`${key}:${out.provider}:${Date.now()}`).digest('hex');
      await this.store.put(this.audioKey(storeKey), body, mime);
      await this.prisma.coachAudio.upsert({
        where: { key: storeKey },
        create: { key: storeKey, mime, bytes: body.length, seconds, provider: out.provider.slice(0, 20), model: out.model.slice(0, 80) },
        update: { lastUsedAt: new Date() },
      });
      return { url: this.audioUrl(storeKey), seconds, mime, cached: false };
    } catch (e) {
      await release();
      throw e;
    }
  }

  /** The daily AI budget's brake applies to speech as to every other AI call (free accounts pause first). */
  private async assertBudget(pro: boolean) {
    const b = await this.usage.budget();
    if (b.state === 'exceeded' && b.brakeMode === 'free_paused' && !pro) {
      throw new AppError(503, 'generation_paused', 'Yoğunluk nedeniyle bu özellik kısa süreliğine durduruldu');
    }
  }

  private alertFailure(f: VoiceFailure, requestId?: string) {
    // Rate limits and short outages pass on their own; money, keys and voices need the founder.
    if (!['billing', 'auth', 'quota', 'bad_voice', 'not_configured'].includes(f.reason)) return;
    return this.alert(f.provider, f.reason, requestId);
  }

  private async alert(provider: string, reason: string, requestId?: string) {
    await this.alerts
      .recordError(new CoachVoiceProblem(`${provider}: ${reason}`), { tags: { route: 'coach.speak' }, requestId })
      .catch((e: Error) => log.warn('coach_alert_failed', { error: e.name }));
  }

  // ---------------------------------------------------------------------------------------------- admin

  /** A fixed sample sentence in the saved voice, so the owner can hear a choice (uses the cache like any reply). */
  async preview(adminId: string, locale: 'tr' | 'en', provider: 'elevenlabs' | 'openai', requestId?: string): Promise<SpokenReply> {
    const text =
      locale === 'tr'
        ? 'Merhaba, ben Casalume koçun. Salonunun fotoğrafını yükle, birlikte yalnız koltuğu değiştirerek başlayalım.'
        : "Hi, I'm your Casalume coach. Upload a photo of your living room and let's start by changing just the armchair.";
    // Every provider of the saved settings can be heard, whatever its place in the chain.
    const chain = voiceChain({ ...this.current.voice, chain: [provider] }, locale);
    if (!chain.length) throw new AppError(400, 'voice_unassigned', 'Önce bu dil için bu sağlayıcıda bir ses seç ve kaydet');
    const key = createHash('sha256').update(JSON.stringify({ v: 1, lang: locale, step: chain[0], text })).digest('hex');
    const hit = await this.prisma.coachAudio.findUnique({ where: { key } });
    if (hit && (await this.store.get(this.audioKey(key)))) return { url: this.audioUrl(key), seconds: hit.seconds, mime: hit.mime, cached: true };
    const out = await this.ai.tts({ text, lang: locale, chain }, requestId);
    await this.usage.record(out.usage, { userId: adminId });
    const body = Buffer.from(out.audio_b64, 'base64');
    const mime = out.mime === 'audio/wav' ? 'audio/wav' : 'audio/mpeg';
    await this.store.put(this.audioKey(key), body, mime);
    const seconds = estimateSeconds(text, this.current.voice.elevenlabs.speed);
    await this.prisma.coachAudio.upsert({
      where: { key },
      create: { key, mime, bytes: body.length, seconds, provider: out.provider.slice(0, 20), model: out.model.slice(0, 80) },
      update: { lastUsedAt: new Date() },
    });
    return { url: this.audioUrl(key), seconds, mime, cached: false };
  }

  async status() {
    const [health, cache, spoken] = await Promise.all([
      this.ai.health(),
      this.prisma.coachAudio.aggregate({ _count: { _all: true }, _sum: { bytes: true } }),
      this.prisma.aiUsage.groupBy({
        by: ['provider'],
        where: { kind: 'tts', createdAt: { gte: new Date(Date.now() - 30 * DAY) } },
        _count: { _all: true },
        _sum: { costUsd: true },
      }),
    ]);
    const v = this.current.voice;
    return {
      configuredProviders: health.voiceProviders,
      assigned: { tr: voiceChain(v, 'tr').map((x) => x.provider), en: voiceChain(v, 'en').map((x) => x.provider) },
      cache: { files: cache._count._all, bytes: cache._sum.bytes ?? 0 },
      last30Days: spoken.map((r) => ({ provider: r.provider, calls: r._count._all, costUsd: Number(r._sum.costUsd ?? 0) })),
    };
  }

  /** Retention (KVKK): spoken replies unused for the panel's cache period go, file and row. */
  async purgeAudio(now = Date.now()) {
    const before = new Date(now - this.current.voice.cacheDays * DAY);
    const old = await this.prisma.coachAudio.findMany({ where: { lastUsedAt: { lt: before } }, select: { key: true }, take: 5_000 });
    if (!old.length) return 0;
    await this.store.delete(old.map((o) => this.audioKey(o.key)));
    await this.prisma.coachAudio.deleteMany({ where: { key: { in: old.map((o) => o.key) } } });
    return old.length;
  }
}
