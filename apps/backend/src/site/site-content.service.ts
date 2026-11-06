import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma } from '../generated/prisma/client.js';
import { compact, contentDiff, DEFAULT_CONTENT, loadDefaults, parseContent, publicContent, type Locale, type SiteContent } from './site-content.rules.js';

// Home page and FAQ (API.md §7.46). One Setting row, kept in memory and refreshed every 15 s like the other admin
// settings; saves run under an advisory lock with the version the editor loaded (BUS-02).

const KEY = 'site.content';
const REFRESH_MS = 15_000;

@Injectable()
export class SiteContentService implements OnModuleInit, OnModuleDestroy {
  private content: SiteContent = DEFAULT_CONTENT;
  private meta: { updatedAt: Date | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null };
  private readonly defaults = loadDefaults();
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    if (!Object.keys(this.defaults).length) log.warn('site_content_defaults_missing', {});
    await this.reload().catch((e: Error) => log.warn('site_content_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reload() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const { content, ok } = parseContent(row?.value);
    if (!ok) log.error('site_content_invalid', { key: KEY });
    this.content = content;
    this.meta = { updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  }

  forLocale(locale: Locale) {
    return publicContent(this.content, locale);
  }

  async forAdmin() {
    await this.reload();
    const editor = this.meta.updatedBy ? await this.prisma.user.findUnique({ where: { id: this.meta.updatedBy }, select: { name: true, email: true } }) : null;
    return {
      content: this.content,
      defaults: this.defaults,
      version: this.meta.updatedAt?.toISOString() ?? null,
      updatedAt: this.meta.updatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.name ?? editor.email) : null,
    };
  }

  async save(next: SiteContent, version: string | null, actorId: string) {
    const value = compact(next);
    const changes = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      if ((row?.updatedAt.toISOString() ?? null) !== version) {
        throw new AppError(409, 'version_conflict', 'İçerik bu arada değişti; sayfayı yenileyip yeniden dene.');
      }
      const diff = contentDiff(parseContent(row?.value).content, value);
      if (!diff.length) return diff;
      const json = value as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: json, updatedBy: actorId }, update: { value: json, updatedBy: actorId } });
      return diff;
    });
    await this.reload();
    return { changes };
  }
}
