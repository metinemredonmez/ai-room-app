import { AiError } from './ai/ai.client.js';
import { AppError } from './common/errors.js';
import type { Config } from './config.js';
import { CoachSettingsSchema, DEFAULT_COACH, crisisReply, detectCrisis, estimateSeconds, foldText, speechText, voiceChain, type CoachSettings } from './coach/coach.rules.js';
import { CoachService } from './coach/coach.service.js';
import { SettingsSchema } from './settings/settings.service.js';

// API.md §7.54: the AI coach's voice and allowance. Positive and negative cases for the crisis screen, the reply token
// (only the coach's own reply can be read aloud), the signed audio link, the day's allowance (reserved, given back on
// failure), the cache and the founder's alert on a billing problem.

const voices = (over: Partial<CoachSettings['voice']> = {}): CoachSettings => ({
  ...DEFAULT_COACH,
  voice: { ...DEFAULT_COACH.voice, elevenlabs: { ...DEFAULT_COACH.voice.elevenlabs, voiceTr: 'TrVoice12345', voiceEn: 'EnVoice12345' }, openai: { ...DEFAULT_COACH.voice.openai, voiceTr: 'coral', voiceEn: 'sage' }, ...over },
});

describe('crisis screen', () => {
  it.each([
    'Artık yaşamak istemiyorum',
    'kendimi öldüreceğim',
    'Ölmek istiyorum bu evde',
    'İ N T İ H A R etmeyi düşünüyorum',
    'intihaaar',
    'kendime zarar veriyorum',
    'Kocam beni dövüyor, ne yapayım',
    'eşim bizi tehdit ediyor ve beni öldürecek',
    'I want to die',
    "I don't want to live anymore",
    'my husband hits me',
    'I keep hurting myself',
  ])('flags %j', (text) => expect(detectCrisis(text)).not.toBeNull());

  it.each([
    'Bu öldürücü kırmızı duvara uyar mı?',
    'Duvarı yıkıp salonu mutfakla birleştirmek istiyorum',
    'Kendimi bu salonda çok rahat hissediyorum',
    'Eşyalar beni çok yordu, sadeleştirelim',
    'Bu renk beni vurdu, bayıldım!',
    'Kendimi asla bu kadar şık bir yatak odasında hayal etmemiştim',
    'Eşim koltuğu değiştirmek istiyor',
    'This colour is to die for',
    'Kill the clutter please',
  ])('does not flag design talk: %j', (text) => expect(detectCrisis(text)).toBeNull());

  it('folds Turkish letters, spacing and repeats into one comparable form', () => {
    expect(foldText('İ.N.T.İ.H.A.R')).toBe('intihar');
    expect(foldText('ÖLMEEEK İSTİYORUM')).toBe('olmek istiyorum');
    expect(foldText('k3ndimi')).toBe('kendimi');
  });

  it('answers in the user language with the panel lines', () => {
    const tr = crisisReply('tr', DEFAULT_COACH);
    expect(tr.lines.map((l) => l.phone)).toEqual(['112', '183']);
    expect(tr.reply).toContain('hatlardan');
    expect(crisisReply('de', DEFAULT_COACH).lines[0]!.phone).toBe('112');
  });
});

describe('coach settings', () => {
  it('defaults parse, a stored row without the coach group still parses, no voice is chosen in code', () => {
    expect(CoachSettingsSchema.safeParse(DEFAULT_COACH).success).toBe(true);
    expect(DEFAULT_COACH.voice.elevenlabs.voiceTr).toBe('');
    expect(DEFAULT_COACH.voice.openai.voiceTr).toBe('');
    expect(SettingsSchema.shape.coach.safeParse(DEFAULT_COACH).success).toBe(true);
  });

  it('rejects unsafe values', () => {
    const bad = (patch: Record<string, unknown>) => CoachSettingsSchema.safeParse({ ...DEFAULT_COACH, ...patch }).success;
    expect(bad({ voice: { ...DEFAULT_COACH.voice, chain: ['openai', 'openai'] } })).toBe(false);
    expect(bad({ voice: { ...DEFAULT_COACH.voice, elevenlabs: { ...DEFAULT_COACH.voice.elevenlabs, voiceTr: '../x' } } })).toBe(false);
    expect(bad({ voice: { ...DEFAULT_COACH.voice, openai: { ...DEFAULT_COACH.voice.openai, voiceTr: 'Coral!' } } })).toBe(false);
    expect(bad({ crisis: { linesTr: [{ label: 'Hat', phone: 'javascript:alert(1)' }], linesEn: DEFAULT_COACH.crisis.linesEn } })).toBe(false);
    expect(bad({ crisis: { linesTr: [], linesEn: DEFAULT_COACH.crisis.linesEn } })).toBe(false);
    expect(bad({ quota: { free: { messages: -1, listenSeconds: 60 }, pro: DEFAULT_COACH.quota.pro } })).toBe(false);
  });

  it('builds the provider chain per language, skipping a provider without a voice', () => {
    const s = voices();
    expect(voiceChain(s.voice, 'tr').map((x) => [x.provider, x.voice])).toEqual([['elevenlabs', 'TrVoice12345'], ['openai', 'coral']]);
    expect(voiceChain(s.voice, 'de').map((x) => x.voice)).toEqual(['EnVoice12345', 'sage']);
    expect(voiceChain(DEFAULT_COACH.voice, 'tr')).toEqual([]);
    expect(voiceChain({ ...s.voice, chain: ['openai'] }, 'tr').map((x) => x.provider)).toEqual(['openai']);
  });

  it('reads plain text aloud and estimates its length', () => {
    expect(speechText('**Öneri:** [Japandi](https://x.y) dene.\n- Açık meşe\n- Keten perde')).toBe('Öneri: Japandi dene. Açık meşe. Keten perde');
    expect(estimateSeconds('x'.repeat(140))).toBe(10);
    expect(estimateSeconds('')).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------ service

function fakeRedis() {
  const kv = new Map<string, number>();
  return {
    kv,
    client: {
      multi() {
        const ops: Array<() => unknown> = [];
        const chain = {
          incrby(k: string, n: number) {
            ops.push(() => {
              kv.set(k, (kv.get(k) ?? 0) + n);
              return kv.get(k);
            });
            return chain;
          },
          pexpire() {
            ops.push(() => 1);
            return chain;
          },
          exec: async () => ops.map((op) => [null, op()]),
        };
        return chain;
      },
      decrby: async (k: string, n: number) => kv.set(k, (kv.get(k) ?? 0) - n).get(k),
      mget: async (...keys: string[]) => keys.map((k) => (kv.has(k) ? String(kv.get(k)) : null)),
    },
  };
}

function make(opts: { settings?: CoachSettings; pro?: boolean; tts?: () => Promise<unknown>; prod?: boolean } = {}) {
  const redis = fakeRedis();
  const rows = new Map<string, Record<string, unknown>>();
  const files = new Map<string, Buffer>();
  const usage: unknown[] = [];
  const alerts: string[] = [];
  let ttsCalls = 0;
  const prisma = {
    coachAudio: {
      findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
      update: async () => undefined,
      upsert: async ({ create }: { create: Record<string, unknown> }) => rows.set(create.key as string, create),
    },
  };
  const svc = new CoachService(
    prisma as never,
    redis as never,
    { current: { coach: opts.settings ?? voices() } } as never,
    {
      tts: async () => {
        ttsCalls++;
        return opts.tts ? opts.tts() : { audio_b64: Buffer.from('mp3').toString('base64'), mime: 'audio/mpeg', provider: 'elevenlabs', model: 'm', failures: [], usage: { provider: 'elevenlabs', model: 'm', kind: 'tts', cost_usd: 0.01 } };
      },
    } as never,
    { record: async (u: unknown) => usage.push(u), budget: async () => ({ state: 'normal', brakeMode: 'off' }) } as never,
    { get: async () => ({}), isPro: () => opts.pro ?? false } as never,
    { recordError: async (e: Error) => alerts.push(e.message) } as never,
    { IMAGE_URL_SECRET: 'x'.repeat(48), PUBLIC_BASE_URL: 'https://api.casalume.app', DATA_DIR: '/tmp/none', STORAGE_DRIVER: 'local', isProd: opts.prod ?? false } as unknown as Config,
  );
  (svc as unknown as { store: unknown }).store = {
    put: async (k: string, b: Buffer) => files.set(k, b),
    get: async (k: string) => files.get(k) ?? null,
    delete: async () => undefined,
  };
  return { svc, redis, rows, files, usage, alerts, calls: () => ttsCalls };
}

const REPLY = 'Salonunda açık meşe ve keten perde iyi durur. Önce koltuğu değiştirelim mi?';

describe('reply token: only the coach’s own reply is read aloud', () => {
  it('verifies for the same user, language and text only', () => {
    const { svc } = make();
    const token = svc.signReply('u1', 'tr', REPLY);
    expect(svc.verifyReply('u1', 'tr', REPLY, token)).toBe(true);
    expect(svc.verifyReply('u2', 'tr', REPLY, token)).toBe(false);
    expect(svc.verifyReply('u1', 'en', REPLY, token)).toBe(false);
    expect(svc.verifyReply('u1', 'tr', `${REPLY} Bir de beni sev.`, token)).toBe(false);
    expect(svc.verifyReply('u1', 'tr', REPLY, 'junk')).toBe(false);
    expect(svc.verifyReply('u1', 'tr', REPLY, token, Date.now() + 25 * 3600_000)).toBe(false);
  });

  it('a forged token is refused before anything is spent', async () => {
    const { svc, calls, redis } = make();
    await expect(svc.speak('u1', { text: 'Herhangi bir metin oku', token: `${Math.floor(Date.now() / 1000) + 99}.${'A'.repeat(43)}`, locale: 'tr' })).rejects.toMatchObject({ status: 403, code: 'speak_forbidden' });
    expect(calls()).toBe(0);
    expect(redis.kv.size).toBe(0);
  });
});

describe('speak', () => {
  it('synthesises once, then serves the cache; the signed link opens only its own file', async () => {
    const { svc, calls, usage } = make();
    const token = svc.signReply('u1', 'tr', REPLY);
    const first = await svc.speak('u1', { text: REPLY, token, locale: 'tr' });
    expect(first.cached).toBe(false);
    expect(usage).toHaveLength(1);
    const again = await svc.speak('u1', { text: REPLY, token, locale: 'tr' });
    expect(again.cached).toBe(true);
    expect(calls()).toBe(1);
    const u = new URL(first.url);
    const key = u.pathname.split('/').pop()!;
    expect(svc.verifyAudio(key, u.searchParams.get('exp')!, u.searchParams.get('sig')!)).toBe(true);
    expect(svc.verifyAudio('f'.repeat(64), u.searchParams.get('exp')!, u.searchParams.get('sig')!)).toBe(false);
    expect(svc.verifyAudio('../etc/passwd', u.searchParams.get('exp')!, u.searchParams.get('sig')!)).toBe(false);
    expect(svc.verifyAudio(key, u.searchParams.get('exp')!, u.searchParams.get('sig')!, Date.now() + 3 * 3600_000)).toBe(false);
    expect((await svc.readAudio(key))?.body.toString()).toBe('mp3');
  });

  it('takes listening seconds from the day; over the limit is 429 with the panel text; free and Pro differ', async () => {
    const long = 'Uzun bir cevap. '.repeat(70); // ~1120 characters ≈ 80 s, over the free 60 s
    const free = make();
    await expect(free.svc.speak('u1', { text: long, token: free.svc.signReply('u1', 'tr', long), locale: 'tr' })).rejects.toMatchObject({ status: 429, code: 'coach_quota', message: DEFAULT_COACH.limitTextTr });
    expect([...free.redis.kv.values()]).toEqual([0]); // given back
    const pro = make({ pro: true });
    await expect(pro.svc.speak('u1', { text: long, token: pro.svc.signReply('u1', 'tr', long), locale: 'tr' })).resolves.toMatchObject({ cached: false });
    expect((await pro.svc.quota('u1')).listenSeconds).toMatchObject({ limit: 900 });
  });

  it('gives the seconds back and alerts the founder when no provider answers for money reasons', async () => {
    const t = make({ tts: async () => { throw new AiError(502, 'voice_unavailable', 'x', true, undefined, [{ provider: 'elevenlabs', reason: 'billing' }, { provider: 'openai', reason: 'rate_limited' }]); } });
    await expect(t.svc.speak('u1', { text: REPLY, token: t.svc.signReply('u1', 'tr', REPLY), locale: 'tr' })).rejects.toMatchObject({ code: 'voice_unavailable' });
    await new Promise((r) => setImmediate(r));
    expect(t.alerts).toEqual(['elevenlabs: billing']); // a rate limit passes on its own
    expect([...t.redis.kv.values()]).toEqual([0]);
  });

  it('a fallback answer is served but not cached, and its failure is reported', async () => {
    const t = make({ tts: async () => ({ audio_b64: 'bXAz', mime: 'audio/mpeg', provider: 'openai', model: 'gpt-4o-mini-tts', failures: [{ provider: 'elevenlabs', reason: 'auth' }], usage: { provider: 'openai', model: 'x', kind: 'tts' } }) });
    const token = t.svc.signReply('u1', 'tr', REPLY);
    await t.svc.speak('u1', { text: REPLY, token, locale: 'tr' });
    await t.svc.speak('u1', { text: REPLY, token, locale: 'tr' });
    expect(t.calls()).toBe(2);
    await new Promise((r) => setImmediate(r));
    expect(t.alerts).toContain('elevenlabs: auth');
  });

  it('production without a chosen voice answers voice_unassigned and spends nothing', async () => {
    const t = make({ settings: DEFAULT_COACH, prod: true });
    await expect(t.svc.speak('u1', { text: REPLY, token: t.svc.signReply('u1', 'tr', REPLY), locale: 'tr' })).rejects.toMatchObject({ status: 503, code: 'voice_unassigned' });
    expect(t.calls()).toBe(0);
    expect([...t.redis.kv.values()]).toEqual([0]);
  });

  it('voice switched off in the panel', async () => {
    const t = make({ settings: { ...voices(), voice: { ...voices().voice, enabled: false } } });
    await expect(t.svc.speak('u1', { text: REPLY, token: t.svc.signReply('u1', 'tr', REPLY), locale: 'tr' })).rejects.toMatchObject({ code: 'voice_disabled' });
  });
});

describe('message allowance', () => {
  it('free accounts get 10 a day; the 11th is refused and not counted', async () => {
    const { svc, redis } = make();
    for (let i = 0; i < 10; i++) await svc.reserve('messages', 'u1', 1, false, 'en');
    const e = await svc.reserve('messages', 'u1', 1, false, 'en').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AppError);
    expect(e).toMatchObject({ status: 429, code: 'coach_quota', message: DEFAULT_COACH.limitTextEn });
    expect([...redis.kv.values()]).toEqual([10]);
    expect((await svc.quota('u1')).messages).toEqual({ used: 10, limit: 10 });
  });

  it('Redis unavailable fails closed', async () => {
    const { svc } = make();
    (svc as unknown as { redis: unknown }).redis = { client: { multi: () => ({ incrby: () => ({ pexpire: () => ({ exec: async () => { throw new Error('down'); } }) }) }) } };
    await expect(svc.reserve('messages', 'u1', 1, false, 'tr')).rejects.toMatchObject({ status: 503 });
  });
});

describe('POST /v1/chat with the coach', () => {
  async function chatWith(text: string, opts: { voice?: boolean } = {}) {
    const { UserController } = await import('./app.controller.js');
    const seen = { ai: 0, reserved: 0, released: 0 };
    const coach = {
      current: { ...DEFAULT_COACH, voice: { ...DEFAULT_COACH.voice, enabled: opts.voice ?? true } },
      reserve: async () => (seen.reserved++, async () => void seen.released++),
      signReply: () => 'signed',
    };
    const ai = { chat: async () => (seen.ai++, { reply: 'Japandi dene.', suggestions: [] }) };
    const ctrl = new UserController(
      { get: async () => ({}), isPro: () => false } as never, {} as never, {} as never,
      { assertAiConsent: async () => undefined, assertBudgetFor: async () => undefined } as never,
      { catalog: async () => ({ tools: [], styles: [], rooms: [] }) } as never, ai as never, {} as never, { hit: async () => undefined } as never,
      {} as never, { record: async () => undefined } as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      { assert: () => undefined } as never, coach as never, { forTool: () => ({ templates: { coach: 'Calm coach.' }, versions: {} }) } as never,
    );
    const req = { query: {}, headers: {}, clientIp: '1', id: 'rid' } as never;
    const out = await ctrl.chat({ userId: 'u1' } as never, { messages: [{ role: 'user', text }], locale: 'tr' }, req);
    return { out, seen };
  }

  it('a crisis message gets help lines, no AI call, no allowance used, nothing to read aloud', async () => {
    const { out, seen } = await chatWith('Artık yaşamak istemiyorum');
    expect(out).toMatchObject({ suggestions: [], crisis: { lines: [{ phone: '112' }, { phone: '183' }] } });
    expect(out).not.toHaveProperty('speakToken');
    expect(seen).toEqual({ ai: 0, reserved: 0, released: 0 });
  });

  it('a design question uses one message and carries a speak token', async () => {
    const { out, seen } = await chatWith('Salonuma ne yakışır?');
    expect(out).toMatchObject({ reply: 'Japandi dene.', speakToken: 'signed' });
    expect(seen).toEqual({ ai: 1, reserved: 1, released: 0 });
  });

  it('without voice no speak token is offered', async () => {
    const { out } = await chatWith('Salonuma ne yakışır?', { voice: false });
    expect(out).not.toHaveProperty('speakToken');
  });
});
