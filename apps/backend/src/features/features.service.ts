import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma } from '../generated/prisma/client.js';

// Feature flags from the admin (API.md §7.28; Palemi feature flags). The list is fixed in code: a flag switches off a
// feature the code knows how to switch off, on the server (refused with 403 `feature_disabled`, or 404 for public
// pages) and in the clients (`GET /v1/features`, also in `/v1/catalog`). Every flag starts on, so nothing changes until
// someone switches one off. Clients treat a flag they cannot read as off ("yanıt yoksa kapalı").

export const FEATURES = {
  assistant_chat: { label: 'AI sohbet asistanı', description: 'Web’deki AI Sohbet ve uygulamadaki asistan. Kapalıyken sohbet isteği reddedilir.', where: ['web', 'mobil', 'API'] },
  cost_analysis: { label: 'Maliyet ve alışveriş listesi', description: 'Sonuçtaki “Ne kadar tutar?” analizi. Kapalıyken yeni analiz yapılmaz; önceden yapılanlar görünür.', where: ['web', 'mobil', 'API'] },
  tap_selection: { label: 'Dokunarak seçim', description: 'Değiştir / Nesne Sil / Duvar Boyası’nda nesneye dokunup seçme. Kapalıyken nesne adı yazılarak seçilir.', where: ['web', 'mobil', 'API'] },
  support_tickets: { label: 'Destek talebi', description: 'Yeni destek talebi açma. Kapalıyken açık talepler okunur ve yanıtlanır, yenisi açılamaz.', where: ['web', 'mobil', 'API'] },
  guest_mode: { label: 'Misafir olarak dene', description: 'Kayıtsız deneme. Kapalıyken yeni misafir hesabı açılmaz; mevcut misafirler girebilir.', where: ['web', 'mobil', 'API'] },
  signup: { label: 'Yeni kayıt', description: 'E-posta ile ve Apple/Google ile yeni hesap açma (misafirin kayda dönmesi dahil). Kapalıyken var olan hesaplar giriş yapar.', where: ['web', 'mobil', 'API'] },
  blog: { label: 'Blog', description: 'Web’deki blog sayfaları ve site haritasındaki yazılar. Kapalıyken sayfalar 404 döner.', where: ['web', 'API'] },
} as const;
export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
export type Flags = Record<FeatureKey, boolean>;

const KEY = 'features';
const REFRESH_MS = 15_000;
export const DEFAULT_FLAGS = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Flags;

/** Exactly the known flags, each a boolean: an unknown key is refused (it would switch nothing). */
export const FlagsInputSchema = z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()])) as Record<FeatureKey, z.ZodBoolean>).strict();

/** Stored row → flags. Missing keys (a flag added in a later deploy) take the default; junk falls back to defaults. */
export function parseFlags(value: unknown): { flags: Flags; ok: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { flags: { ...DEFAULT_FLAGS }, ok: value === undefined };
  const v = value as Record<string, unknown>;
  const flags = { ...DEFAULT_FLAGS };
  let ok = true;
  for (const k of FEATURE_KEYS) {
    if (v[k] === undefined) continue;
    if (typeof v[k] === 'boolean') flags[k] = v[k] as boolean;
    else ok = false;
  }
  return { flags, ok };
}

export function flagsDiff(prev: Flags, next: Flags): string[] {
  return FEATURE_KEYS.filter((k) => prev[k] !== next[k]).map((k) => `${k}: ${prev[k] ? 'açık' : 'kapalı'} → ${next[k] ? 'açık' : 'kapalı'}`);
}

@Injectable()
export class FeaturesService implements OnModuleInit, OnModuleDestroy {
  private flags: Flags = { ...DEFAULT_FLAGS };
  private meta: { updatedAt: Date | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null };
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload().catch((e: Error) => log.warn('features_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reload() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const { flags, ok } = parseFlags(row?.value);
    if (!ok) log.error('features_invalid', { key: KEY });
    this.flags = flags;
    this.meta = { updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  }

  get current(): Flags {
    return { ...this.flags };
  }

  enabled(key: FeatureKey): boolean {
    return this.flags[key];
  }

  /** Refuses a switched-off feature with a clear message (an old app may still offer it). */
  assert(key: FeatureKey) {
    if (!this.flags[key]) throw new AppError(403, 'feature_disabled', `${FEATURES[key].label} şu an kapalı.`, {}, { feature: key });
  }

  async forAdmin() {
    await this.reload();
    const editor = this.meta.updatedBy ? await this.prisma.user.findUnique({ where: { id: this.meta.updatedBy }, select: { name: true, email: true } }) : null;
    return {
      features: FEATURE_KEYS.map((k) => ({ key: k, ...FEATURES[k], enabled: this.flags[k] })),
      version: this.meta.updatedAt?.toISOString() ?? null,
      updatedAt: this.meta.updatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.name ?? editor.email) : null,
    };
  }

  /** Under an advisory lock with the version the editor loaded (BUS-02). */
  async save(next: Flags, version: string | null, actorId: string) {
    const changes = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      if ((row?.updatedAt.toISOString() ?? null) !== version) {
        throw new AppError(409, 'version_conflict', 'Ayar bu arada değişti; sayfayı yenileyip yeniden dene.');
      }
      const prev = parseFlags(row?.value).flags;
      const value = next as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      return flagsDiff(prev, next);
    });
    await this.reload();
    return { changes };
  }
}
