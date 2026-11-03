import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type Config } from '../config.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import type { Prisma } from '../generated/prisma/client.js';

// Runtime settings (pattern from maeyja settings.defaults.ts + palemi runtime_settings): typed defaults
// in code, overrides in the Setting table, editable from the admin API without a deploy.

const variants = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const text = (max: number) => z.string().max(max);

export const SettingsSchema = z
  .object({
    freeDailyGenerations: z.number().int().min(0).max(1000),
    proDailyGenerations: z.number().int().min(1).max(1000),
    maxVariantsFree: variants,
    maxVariantsPro: variants,
    dailyBudgetUsd: z.number().min(0).max(100_000),
    budgetBrakeMode: z.enum(['off', 'free_single_variant', 'free_paused']),
    maintenance: z.object({ enabled: z.boolean(), messageTr: text(300), messageEn: text(300) }).strict(),
    announcement: z.object({ enabled: z.boolean(), textTr: text(300), textEn: text(300) }).strict(),
    requireAiConsent: z.boolean(),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;
export const SETTING_KEYS = Object.keys(SettingsSchema.shape) as Array<keyof Settings>;

const REFRESH_MS = 15_000;

@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  readonly defaults: Settings;
  private values: Settings;
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService, @Inject(CONFIG) cfg: Config) {
    this.defaults = {
      freeDailyGenerations: cfg.FREE_DAILY_GENERATIONS,
      proDailyGenerations: cfg.PRO_DAILY_GENERATIONS,
      maxVariantsFree: 2,
      maxVariantsPro: 4,
      dailyBudgetUsd: 0,
      budgetBrakeMode: 'free_single_variant',
      maintenance: {
        enabled: false,
        messageTr: 'Kısa bir bakım yapıyoruz, birazdan tekrar dene.',
        messageEn: 'We are doing short maintenance, please try again shortly.',
      },
      announcement: { enabled: false, textTr: '', textEn: '' },
      requireAiConsent: false,
    };
    this.values = this.defaults;
  }

  async onModuleInit() {
    await this.reload().catch((e: Error) => log.warn('settings_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Last known values; refreshed every 15 s (and immediately on update) so every replica converges. */
  get current(): Settings {
    return this.values;
  }

  async reload(): Promise<Settings> {
    const rows = await this.prisma.setting.findMany();
    const merged: Record<string, unknown> = { ...this.defaults };
    for (const r of rows) if ((SETTING_KEYS as string[]).includes(r.key)) merged[r.key] = r.value;
    const parsed = SettingsSchema.safeParse(merged);
    // A corrupt row must never take the app down or silently widen limits: fall back to defaults.
    this.values = parsed.success ? parsed.data : this.defaults;
    if (!parsed.success) log.error('settings_invalid', { fields: parsed.error.issues.map((i) => i.path.join('.')) });
    return this.values;
  }

  async update(patch: unknown, actorId: string): Promise<{ values: Settings; changed: string[] }> {
    const partial = SettingsSchema.partial().strict().safeParse(patch);
    if (!partial.success) {
      throw new AppError(400, 'validation_failed', `Geçersiz ayarlar: ${[...new Set(partial.error.issues.map((i) => i.path.join('.')))].join(', ')}`);
    }
    const next = SettingsSchema.parse({ ...this.values, ...partial.data });
    const changed = Object.keys(partial.data);
    await this.prisma.$transaction(
      changed.map((key) =>
        this.prisma.setting.upsert({
          where: { key },
          create: { key, value: next[key as keyof Settings] as Prisma.InputJsonValue, updatedBy: actorId },
          update: { value: next[key as keyof Settings] as Prisma.InputJsonValue, updatedBy: actorId },
        }),
      ),
    );
    this.values = next;
    return { values: next, changed };
  }
}
