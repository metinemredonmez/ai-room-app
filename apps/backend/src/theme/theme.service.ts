import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma } from '../generated/prisma/client.js';
import { contrastReport, parseTheme, publicTheme, themeDiff, toStored, type Theme, BUILTIN_THEME } from './theme.rules.js';

// Colour themes (API.md §7.34). One Setting row, kept in memory and refreshed every 15 s like the other admin
// settings; saves run under an advisory lock with the version the editor loaded (BUS-02).

const KEY = 'ui.theme';
const REFRESH_MS = 15_000;

@Injectable()
export class ThemeService implements OnModuleInit, OnModuleDestroy {
  private theme: Theme = BUILTIN_THEME;
  private meta: { updatedAt: Date | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null };
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload().catch((e: Error) => log.warn('theme_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reload() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const { theme, ok } = parseTheme(row?.value);
    if (!ok) log.error('theme_invalid', { key: KEY });
    this.theme = theme;
    this.meta = { updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  }

  get public() {
    return publicTheme(this.theme);
  }

  async forAdmin() {
    await this.reload();
    const editor = this.meta.updatedBy ? await this.prisma.user.findUnique({ where: { id: this.meta.updatedBy }, select: { name: true, email: true } }) : null;
    return {
      defaultId: this.theme.defaultId,
      palettes: this.theme.palettes.map((p) => ({ ...p, contrast: contrastReport(p.tokens) })),
      builtinIds: BUILTIN_THEME.palettes.map((p) => p.id),
      version: this.meta.updatedAt?.toISOString() ?? null,
      updatedAt: this.meta.updatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.name ?? editor.email) : null,
    };
  }

  /** The whole theme set at once. A switched-on palette must pass the blocking contrast checks. */
  async save(next: Theme, version: string | null, actorId: string) {
    const failing = next.palettes.filter((p) => p.enabled && contrastReport(p.tokens).blocking.length);
    if (failing.length) {
      throw new AppError(400, 'contrast_failed', `Okunurluk yetersiz, açılamaz: ${failing.map((p) => p.name.tr).join(', ')}. Paleti kapalı kaydedebilir ya da tonlarını değiştirebilirsin.`);
    }
    const changes = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      if ((row?.updatedAt.toISOString() ?? null) !== version) {
        throw new AppError(409, 'version_conflict', 'Ayar bu arada değişti; sayfayı yenileyip yeniden dene.');
      }
      const prev = parseTheme(row?.value).theme;
      const value = toStored(next) as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      return themeDiff(prev, next);
    });
    await this.reload();
    return { changes };
  }
}
