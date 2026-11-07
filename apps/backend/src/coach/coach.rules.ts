import { z } from 'zod';

// API.md §7.54: the AI coach's settings and the pure rules around it (crisis screen, text for speech, quota maths).
// Kept free of Nest and I/O so every branch is unit-tested (coach.spec.ts).

const MODEL_ID = /^[A-Za-z0-9._:-]{1,80}$/;
/** ElevenLabs voice ids are opaque alphanumerics; OpenAI voices are lowercase names. Empty = not chosen yet. */
const ELEVEN_VOICE = /^(?:|[A-Za-z0-9]{10,40})$/;
const OPENAI_VOICE = /^(?:|[a-z]{2,20})$/;
const PHONE = /^[0-9+][0-9 ]{1,18}$/;

export const VOICE_PROVIDERS = ['elevenlabs', 'openai'] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];

const crisisLine = z.object({ label: z.string().trim().min(2).max(60), phone: z.string().trim().regex(PHONE) }).strict();
const quotaTier = z
  .object({
    messages: z.number().int().min(0).max(1000),
    listenSeconds: z.number().int().min(0).max(36_000),
  })
  .strict();

export const CoachSettingsSchema = z
  .object({
    voice: z
      .object({
        enabled: z.boolean(),
        /** Tried in order; the second one is the fallback. */
        chain: z
          .array(z.enum(VOICE_PROVIDERS))
          .min(1)
          .max(2)
          .refine((c) => new Set(c).size === c.length, 'aynı sağlayıcı iki kez olamaz'),
        elevenlabs: z
          .object({
            model: z.string().regex(MODEL_ID),
            voiceTr: z.string().regex(ELEVEN_VOICE),
            voiceEn: z.string().regex(ELEVEN_VOICE),
            stability: z.number().min(0).max(1),
            speed: z.number().min(0.7).max(1.2),
          })
          .strict(),
        openai: z
          .object({
            model: z.string().regex(MODEL_ID),
            voiceTr: z.string().regex(OPENAI_VOICE),
            voiceEn: z.string().regex(OPENAI_VOICE),
          })
          .strict(),
        /** Days an unused spoken reply stays in the cache (KVKK: the text is the user's conversation). */
        cacheDays: z.number().int().min(1).max(90),
      })
      .strict(),
    quota: z.object({ free: quotaTier, pro: quotaTier }).strict(),
    /** Shown when the day's coach allowance is used up. */
    limitTextTr: z.string().trim().min(5).max(300),
    limitTextEn: z.string().trim().min(5).max(300),
    /** Verified help lines shown, without any AI call or charge, when a message carries crisis signs. */
    crisis: z.object({ linesTr: z.array(crisisLine).min(1).max(5), linesEn: z.array(crisisLine).min(1).max(5) }).strict(),
  })
  .strict();
export type CoachSettings = z.infer<typeof CoachSettingsSchema>;

/**
 * Defaults. No voice is chosen in code (fal-app lesson: hard-coded voices were retired by the provider and silently
 * replaced); the owner picks them in the panel, and until then speech answers `voice_unassigned`.
 * Lines verified for Türkiye: 112 is the emergency number (there is no separate national suicide line), ALO 183 is the
 * ministry's 24/7 social support line. Never 182 (hospital appointments).
 */
export const DEFAULT_COACH: CoachSettings = {
  voice: {
    enabled: true,
    chain: ['elevenlabs', 'openai'],
    elevenlabs: { model: 'eleven_multilingual_v2', voiceTr: '', voiceEn: '', stability: 0.5, speed: 1 },
    openai: { model: 'gpt-4o-mini-tts', voiceTr: '', voiceEn: '' },
    cacheDays: 30,
  },
  quota: { free: { messages: 10, listenSeconds: 60 }, pro: { messages: 100, listenSeconds: 900 } },
  limitTextTr: 'Bugünkü koç hakkın doldu. Yarın kaldığımız yerden devam edelim; Pro ile her gün daha çok konuşabilirsin.',
  limitTextEn: "You've used today's coach allowance. Let's pick up tomorrow; Pro gives you more every day.",
  crisis: {
    linesTr: [
      { label: 'Acil Çağrı (hayati tehlike)', phone: '112' },
      { label: 'ALO 183 Sosyal Destek Hattı', phone: '183' },
    ],
    linesEn: [{ label: 'Emergency (Türkiye and the EU)', phone: '112' }],
  },
};

// ------------------------------------------------------------------------------------------------ crisis screen

export type CrisisKind = 'suicide' | 'self_harm' | 'violence';

const FOLD: Record<string, string> = { ı: 'i', İ: 'i', I: 'i', ş: 's', ğ: 'g', ç: 'c', ö: 'o', ü: 'u', â: 'a', î: 'i', û: 'u' };

/**
 * One comparable form: invisible characters out, Turkish letters folded, digits that stand for letters read as
 * letters, letters spaced or dotted apart joined ("i n t i h a r", "i.n.t.i.h.a.r"), long repeats shortened
 * ("ölmeeek"). Pattern from fal-app's crisis filter and the yoga guardrail.
 */
export function foldText(input: string): string {
  let t = input.normalize('NFKC').replace(/[​-‏⁠﻿­]/g, '');
  t = t.replace(/[ıİIşğçöüâîû]/g, (c) => FOLD[c] ?? c).toLowerCase();
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/(?<=[a-z])[0134@$](?=[a-z])/g, (c) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '@': 'a', $: 's' })[c] ?? c);
  t = t.replace(/(?<![a-z])(?:[a-z][ ._\-*]){3,}[a-z](?![a-z])/g, (m) => m.replace(/[ ._\-*]/g, ''));
  t = t.replace(/([a-z])\1{2,}/g, '$1');
  return t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Patterns run on folded text. They aim at statements about a person's safety, not at design words: "öldürücü kırmızı"
// or "duvarı yık" never match, "kendimi öldüreceğim" or "kocam beni dövüyor" always do. A miss is backed by the system
// prompt (the model answers with help lines too); a false alarm costs one free, polite answer.
const PATTERNS: Array<{ kind: CrisisKind; re: RegExp }> = [
  {
    kind: 'suicide',
    re: /\bintihar\w*|\bkendi(?:mi|ni|ni?zi)\s+(?:oldur\w*|as(?:a|ac|ar|ma|mak|ti|iyor)\w*|bitir\w*|yok\s+ed\w*)|\bolm(?:ek|eyi|eye|em)\s+(?:\w+\s+){0,2}(?:isti\w*|dusun\w*)|\byasamak\s+(?:\w+\s+)?istemi\w*|\bhayat\w*\s+son\s+ver\w*|\bcan\w*\s+kiy\w*|\byasamanin\s+(?:bir\s+)?anlami\s+(?:kalmadi|yok)|\bsuicid\w*|\bkill\s+my\s*self|\bend\s+(?:it\s+all|my\s+life)|\bwant\s+to\s+die|\bdon\s?t\s+want\s+to\s+(?:live|be\s+alive)|\bbetter\s+off\s+dead/,
  },
  {
    kind: 'self_harm',
    re: /\bkendi(?:me|ne|nize)\s+zarar\s+ver\w*|\bkendi(?:mi|ni)\s+kes\w*|\bbilek\w*\s+kes\w*|\bself\s*harm\w*|\b(?:hurt|cut|harm)(?:ing)?\s+my\s*self/,
  },
  {
    kind: 'violence',
    re: /\b(?:es(?:im|in|i)|koca(?:m|n|si)|karim|sevgili(?:m|n|si)|baba(?:m|n|si)|anne(?:m|n|si)|abi(?:m|n|si)|partner\w*)\s+(?:\w+\s+){0,2}(?:beni|bizi|cocug\w*)\s+(?:\w+\s+)?(?:dov\w*|doveceg\w*|oldurece\w*|tehdit\s+ed\w*|vur\w*)|\b(?:beni|bizi)\s+(?:\w+\s+)?(?:dovuyor\w*|dovdu\w*|oldurece\w*|olduruce\w*)|\b(?:onu|seni|esimi|kocami|karimi)\s+oldurece\w*|\b(?:he|she|my\s+(?:husband|wife|partner|boyfriend|girlfriend|father|mother))\s+(?:\w+\s+)?(?:hits|beats|is\s+hitting|is\s+beating|threatens\s+to\s+kill)\s+me|\b(?:going\s+to|gonna)\s+kill\s+(?:him|her|them|you)/,
  },
];

/** The first crisis sign in a message, or null. Only the user's own latest message is screened. */
export function detectCrisis(text: string): CrisisKind | null {
  const folded = foldText(text);
  for (const p of PATTERNS) if (p.re.test(folded)) return p.kind;
  return null;
}

export function crisisReply(locale: string, s: CoachSettings): { reply: string; lines: Array<{ label: string; phone: string }> } {
  const tr = locale === 'tr';
  const lines = tr ? s.crisis.linesTr : s.crisis.linesEn;
  const reply = tr
    ? 'Yazdıkların beni endişelendirdi ve seni ciddiye alıyorum. Şu an güvende değilsen ya da kendine veya bir başkasına zarar gelmesinden korkuyorsan lütfen hemen aşağıdaki hatlardan birini ara. Yalnız değilsin; güvendiğin birine de haber vermek iyi gelebilir.'
    : "What you wrote worries me, and I take it seriously. If you are not safe right now, or you fear harm to yourself or someone else, please call one of the lines below now. You are not alone; letting someone you trust know can help too.";
  return { reply, lines };
}

// ------------------------------------------------------------------------------------------------ speech

export const SPEAK_MAX_CHARS = 3000;

/** What the voice reads: Markdown marks and links out, bullets as pauses, whitespace flattened. */
export function speechText(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/[*_#`>~|]+/g, '')
    .replace(/([^.!?:;,\s])[ \t]*\n+\s*/g, '$1. ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SPEAK_MAX_CHARS);
}

/** Seconds of speech for a text: about 14 characters a second at normal speed (Turkish and English alike). */
export function estimateSeconds(text: string, speed = 1): number {
  return Math.max(1, Math.ceil(text.length / (14 * Math.max(0.5, speed))));
}

/** Which language's voice reads a reply: Turkish replies get the Turkish voice, every other language the English one. */
export const voiceLang = (locale: string): 'tr' | 'en' => (locale === 'tr' ? 'tr' : 'en');

/** The provider steps the AI service gets, in order; a provider without a voice for this language is skipped. */
export function voiceChain(s: CoachSettings['voice'], locale: string) {
  const lang = voiceLang(locale);
  const steps: Array<
    | { provider: 'elevenlabs'; model: string; voice: string; stability: number; speed: number }
    | { provider: 'openai'; model: string; voice: string; instructions: string }
  > = [];
  for (const p of s.chain) {
    if (p === 'elevenlabs') {
      const voice = lang === 'tr' ? s.elevenlabs.voiceTr : s.elevenlabs.voiceEn;
      if (voice) steps.push({ provider: 'elevenlabs', model: s.elevenlabs.model, voice, stability: s.elevenlabs.stability, speed: s.elevenlabs.speed });
    } else {
      const voice = lang === 'tr' ? s.openai.voiceTr : s.openai.voiceEn;
      if (voice) {
        steps.push({
          provider: 'openai',
          model: s.openai.model,
          voice,
          instructions: 'Warm, calm and friendly interior design coach. Natural pace, clear pronunciation.',
        });
      }
    }
  }
  return steps;
}
