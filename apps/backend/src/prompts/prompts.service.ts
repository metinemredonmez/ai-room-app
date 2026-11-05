import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AiClient } from '../ai/ai.client.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma } from '../generated/prisma/client.js';
import { isUuid } from '../images/images.service.js';

// Image prompt templates from the admin (API.md §7.26; YediOda #30, fal-app prompt-resolver). The AI service owns the
// defaults and the rules (which placeholders a template may use); the backend keeps every published version
// (`PromptVersion`, append-only) and which one is live per key (Setting `ai.prompts`: key → version id). Live texts are
// held in memory, refreshed every 15 s and at once on change, and sent with each generation.

const KEY = 'ai.prompts';
const REFRESH_MS = 15_000;
const TEMPLATE_KEY = /^[a-z_]{2,40}$/;
const HISTORY = 20;

const ISSUE_TEXT: Record<string, string> = {
  length: 'uzunluk 10–1500 karakter olmalı (ortak cümlede en çok 600)',
  control_chars: 'görünmez kontrol karakteri var',
  stray_brace: 'süslü parantez yalnız {alan} biçiminde kullanılabilir',
  unknown_key: 'bilinmeyen şablon',
};

/** The AI service's error codes in Turkish, for the panel. */
export function templateIssues(errors: string[]): string {
  return errors
    .slice(0, 4)
    .map((e) => {
      const [code, name] = e.replace(/^keep:/, '').split(':');
      if (code === 'unknown_placeholder') return `{${name}} bu şablonda kullanılamaz`;
      if (code === 'missing_placeholder') return `{${name}} şablonda bulunmalı`;
      return ISSUE_TEXT[code] ?? 'geçersiz şablon';
    })
    .join('; ');
}

export function parseActive(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k, v]) => TEMPLATE_KEY.test(k) && typeof v === 'string' && isUuid(v))) as Record<string, string>;
}

type Live = Record<string, { versionId: string; text: string }>;

@Injectable()
export class PromptTemplatesService implements OnModuleInit, OnModuleDestroy {
  private live: Live = {};
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService, private ai: AiClient) {}

  async onModuleInit() {
    await this.reload().catch((e: Error) => log.warn('prompt_templates_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reload() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const map = parseActive(row?.value);
    const ids = Object.values(map);
    const rows = ids.length ? await this.prisma.promptVersion.findMany({ where: { id: { in: ids } }, select: { id: true, key: true, text: true } }) : [];
    this.live = Object.fromEntries(
      Object.entries(map).flatMap(([k, vid]) => {
        const v = rows.find((r) => r.id === vid && r.key === k);
        return v ? [[k, { versionId: v.id, text: v.text }]] : [];
      }),
    );
  }

  /** For one generation: the live templates this tool uses (its own keys and the shared `keep`), and their versions. */
  forTool(tool: string): { templates?: Record<string, string>; versions: Record<string, string> } {
    const keys = Object.keys(this.live).filter((k) => k === 'keep' || k === tool || k.startsWith(`${tool}_`));
    if (!keys.length) return { versions: {} };
    return {
      templates: Object.fromEntries(keys.map((k) => [k, this.live[k].text])),
      versions: Object.fromEntries(keys.map((k) => [k, this.live[k].versionId])),
    };
  }

  async forAdmin() {
    await this.reload();
    const [catalog, versions] = await Promise.all([
      this.ai.promptCatalog(),
      this.prisma.promptVersion.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500 }),
    ]);
    const editorIds = [...new Set(versions.map((v) => v.createdById).filter((x): x is string => !!x))];
    const editors = editorIds.length ? await this.prisma.user.findMany({ where: { id: { in: editorIds } }, select: { id: true, name: true, email: true } }) : [];
    const who = new Map(editors.map((u) => [u.id, u.name ?? u.email]));
    return {
      templates: catalog.templates.map((t) => ({
        ...t,
        activeVersionId: this.live[t.key]?.versionId ?? null,
        text: this.live[t.key]?.text ?? t.default,
        versions: versions
          .filter((v) => v.key === t.key)
          .slice(0, HISTORY)
          .map((v) => ({ id: v.id, text: v.text, note: v.note, createdAt: v.createdAt.toISOString(), createdBy: v.createdById ? (who.get(v.createdById) ?? null) : null })),
      })),
      placeholders: catalog.placeholders,
    };
  }

  /** Renders a draft with sample values; the live shared sentence is used so the preview matches production. */
  preview(key: string, text: string) {
    const keep = key !== 'keep' ? this.live.keep?.text : undefined;
    return this.ai.previewPrompt({ key, template: text, ...(keep ? { keep } : {}) });
  }

  private async check(key: string, text: string) {
    if (!TEMPLATE_KEY.test(key)) throw notFound();
    // Fail-closed: if the AI service cannot validate, nothing is published.
    const { errors } = await this.ai.previewPrompt({ key, template: text });
    if (errors.includes('unknown_key')) throw notFound();
    if (errors.length) throw new AppError(400, 'invalid_template', `Şablon kaydedilemedi — ${templateIssues(errors)}`, {}, { errors });
  }

  /** Under an advisory lock, with the live version the editor saw (`expected`, null = default): BUS-02. */
  private async swap(key: string, expected: string | null, next: (tx: Prisma.TransactionClient) => Promise<string | null>, actorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      const map = parseActive(row?.value);
      const previous = map[key] ?? null;
      if (previous !== expected) throw new AppError(409, 'version_conflict', 'Şablon bu arada değişti; sayfayı yenileyip yeniden dene.');
      const versionId = await next(tx);
      if (versionId) map[key] = versionId;
      else delete map[key];
      const value = map as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      return { previous, versionId };
    });
    await this.reload();
    return result;
  }

  /** Publishes a new version and makes it live. */
  async publish(key: string, text: string, note: string, expected: string | null, actorId: string) {
    await this.check(key, text);
    if ((this.live[key]?.text ?? null) === text) throw new AppError(400, 'no_change', 'Bu metin zaten yayında.');
    return this.swap(key, expected, async (tx) => (await tx.promptVersion.create({ data: { key, text, note, createdById: actorId } })).id, actorId);
  }

  /** Puts an earlier version back (or the service default with null); its text is checked again first. */
  async activate(key: string, versionId: string | null, expected: string | null, actorId: string) {
    if (versionId) {
      const v = isUuid(versionId) ? await this.prisma.promptVersion.findUnique({ where: { id: versionId } }) : null;
      if (!v || v.key !== key) throw notFound();
      await this.check(key, v.text);
    } else {
      if (!TEMPLATE_KEY.test(key)) throw notFound();
      const keys = (await this.ai.promptCatalog()).templates.map((t) => t.key);
      if (!keys.includes(key)) throw notFound();
    }
    return this.swap(key, expected, async () => versionId, actorId);
  }
}
