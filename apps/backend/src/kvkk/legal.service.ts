import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, type Config } from '../config.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import type { LegalDocument } from '../generated/prisma/client.js';
import { INITIAL_LEGAL_VERSION, LEGAL_KINDS, LEGAL_LOCALES, type LegalKind, type LegalLocale } from './legal.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/legal');
const REFRESH_MS = 60_000;
/** Bodies are Markdown rendered as text by the clients; raw HTML is refused (WEB-01 defence in depth). */
export const HTML_TAG = /<\/?[a-z][^>]*>/i;

export interface Current {
  version: string; // shown to new users and accepted on consent
  consentVersion: string; // the last version that required a fresh acceptance
  publishedAt: Date | null;
}

export interface DraftInput {
  kind: LegalKind;
  version: string;
  locale: LegalLocale;
  title: string;
  body: string;
  requiresConsent: boolean;
}

/**
 * Versioned legal texts. Published rows are immutable: they are the evidence of what a user accepted.
 * A wording fix can be published with `requiresConsent: false`, so earlier acceptances stay valid.
 */
@Injectable()
export class LegalService implements OnModuleInit, OnModuleDestroy {
  private current = new Map<LegalKind, Current>();
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService, @Inject(CONFIG) private cfg: Config) {}

  async onModuleInit() {
    await this.ensureDefaults().catch((e: Error) => log.error('legal_seed_failed', { error: e.name }));
    await this.reload().catch((e: Error) => log.warn('legal_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** First boot: publish the bundled texts for any kind that has none yet (race-safe: unique + skipDuplicates). */
  async ensureDefaults() {
    const present = new Set((await this.prisma.legalDocument.findMany({ select: { kind: true }, distinct: ['kind'] })).map((r) => r.kind));
    const missing = LEGAL_KINDS.filter((k) => !present.has(k));
    if (!missing.length) return;
    const now = new Date();
    const rows = await Promise.all(
      missing.flatMap((kind) =>
        LEGAL_LOCALES.map(async (locale) => {
          const md = await readFile(path.join(ASSETS, `${kind}.${locale}.md`), 'utf8');
          const [first, ...rest] = md.split('\n');
          return {
            kind, locale, version: INITIAL_LEGAL_VERSION, title: first!.replace(/^#\s*/, '').trim(), body: rest.join('\n').trim(),
            requiresConsent: true, publishedAt: now,
          };
        }),
      ),
    );
    await this.prisma.legalDocument.createMany({ data: rows, skipDuplicates: true });
    log.info('legal_defaults_published', { kinds: missing });
  }

  async reload() {
    const rows = await this.prisma.legalDocument.findMany({
      where: { locale: 'tr', publishedAt: { not: null } },
      select: { kind: true, version: true, requiresConsent: true, publishedAt: true },
      orderBy: { version: 'desc' },
    });
    const next = new Map<LegalKind, Current>();
    for (const kind of LEGAL_KINDS) {
      const versions = rows.filter((r) => r.kind === kind);
      const latest = versions[0];
      // The oldest version always required consent: there was nothing to keep valid before it.
      const consent = versions.find((r) => r.requiresConsent) ?? versions[versions.length - 1];
      next.set(kind, latest
        ? { version: latest.version, consentVersion: consent!.version, publishedAt: latest.publishedAt }
        : { version: INITIAL_LEGAL_VERSION, consentVersion: INITIAL_LEGAL_VERSION, publishedAt: null });
    }
    this.current = next;
  }

  versionOf(kind: LegalKind): Current {
    return this.current.get(kind) ?? { version: INITIAL_LEGAL_VERSION, consentVersion: INITIAL_LEGAL_VERSION, publishedAt: null };
  }

  /** An acceptance stays valid until a version that requires fresh consent is published. */
  acceptanceValid(kind: LegalKind, acceptedVersion: string) {
    return acceptedVersion >= this.versionOf(kind).consentVersion;
  }

  index(locale: LegalLocale) {
    return LEGAL_KINDS.map((kind) => {
      const c = this.versionOf(kind);
      return { kind, version: c.version, consentVersion: c.consentVersion, publishedAt: c.publishedAt?.toISOString() ?? null, url: `/v1/legal/${kind}?locale=${locale}` };
    });
  }

  /** A published text (current, or an older version a user accepted), in the locale or Turkish. */
  async document(kind: LegalKind, locale: LegalLocale, version?: string) {
    const v = version ?? this.versionOf(kind).version;
    const rows = await this.prisma.legalDocument.findMany({ where: { kind, version: v, publishedAt: { not: null }, locale: { in: [locale, 'tr'] } } });
    const doc = rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === 'tr');
    if (!doc) throw notFound();
    return {
      kind, version: doc.version, locale: doc.locale, title: doc.title, body: this.render(doc.body), format: 'markdown' as const,
      requiresConsent: doc.requiresConsent, publishedAt: doc.publishedAt!.toISOString(), current: doc.version === this.versionOf(kind).version,
    };
  }

  /** Placeholders are filled from the environment, so the data controller's details live in one place. */
  render(body: string) {
    const values: Record<string, string> = {
      'controller.name': this.cfg.LEGAL_CONTROLLER_NAME,
      'controller.address': this.cfg.LEGAL_CONTROLLER_ADDRESS,
      'controller.email': this.cfg.LEGAL_CONTACT_EMAIL,
      'controller.kep': this.cfg.LEGAL_KEP_ADDRESS ?? '—',
    };
    return body.replace(/\{\{\s*([a-z.]+)\s*\}\}/g, (m, key: string) => values[key] ?? m);
  }

  // ---- admin

  list(kind?: LegalKind) {
    return this.prisma.legalDocument.findMany({ where: kind ? { kind } : {}, orderBy: [{ kind: 'asc' }, { version: 'desc' }, { locale: 'asc' }] });
  }

  async get(id: string) {
    const row = await this.prisma.legalDocument.findUnique({ where: { id } });
    if (!row) throw notFound();
    return row;
  }

  async createDraft(input: DraftInput, actorId: string) {
    this.assertBody(input.title, input.body);
    if (input.version <= this.versionOf(input.kind).version) {
      throw new AppError(409, 'conflict', `Yeni sürüm yayındaki ${this.versionOf(input.kind).version} sürümünden büyük olmalı`);
    }
    const published = await this.prisma.legalDocument.count({ where: { kind: input.kind, version: input.version, publishedAt: { not: null } } });
    if (published) throw new AppError(409, 'conflict', 'Bu sürüm yayınlanmış; yeni bir sürüm numarası kullanın');
    try {
      return await this.prisma.legalDocument.create({ data: { ...input, createdBy: actorId } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002' || (e as { cause?: { kind?: string } }).cause?.kind === 'UniqueConstraintViolation') {
        throw new AppError(409, 'conflict', 'Bu tür, sürüm ve dil için zaten bir taslak var');
      }
      throw e;
    }
  }

  async updateDraft(id: string, patch: Partial<Pick<DraftInput, 'title' | 'body' | 'requiresConsent'>>) {
    const row = await this.get(id);
    if (row.publishedAt) throw new AppError(409, 'conflict', 'Yayınlanmış metin değiştirilemez; yeni sürüm oluşturun');
    this.assertBody(patch.title ?? row.title, patch.body ?? row.body);
    // Only an unpublished row can match: a parallel publish makes this a no-op instead of editing evidence.
    const updated = await this.prisma.legalDocument.updateMany({ where: { id, publishedAt: null }, data: patch });
    if (!updated.count) throw new AppError(409, 'conflict', 'Metin bu sırada yayınlandı');
    return this.get(id);
  }

  async deleteDraft(id: string) {
    const deleted = await this.prisma.legalDocument.deleteMany({ where: { id, publishedAt: null } });
    if (!deleted.count) throw new AppError(409, 'conflict', 'Yalnız yayınlanmamış taslak silinebilir');
  }

  /** Publishes every locale of a version at once; the Turkish text is required (it prevails). */
  async publish(kind: LegalKind, version: string, actorId: string): Promise<LegalDocument[]> {
    const drafts = await this.prisma.legalDocument.findMany({ where: { kind, version, publishedAt: null } });
    if (!drafts.some((d) => d.locale === 'tr')) throw new AppError(400, 'bad_request', 'Yayın için Türkçe metin gerekli');
    if (version <= this.versionOf(kind).version) throw new AppError(409, 'conflict', 'Yayındaki sürümden eski ya da aynı sürüm yayınlanamaz');
    const tr = drafts.find((d) => d.locale === 'tr')!;
    await this.prisma.legalDocument.updateMany({
      where: { kind, version, publishedAt: null },
      // The Turkish text decides whether users must accept again.
      data: { publishedAt: new Date(), publishedBy: actorId, requiresConsent: tr.requiresConsent },
    });
    await this.reload();
    return this.prisma.legalDocument.findMany({ where: { kind, version } });
  }

  private assertBody(title: string, body: string) {
    if (HTML_TAG.test(title) || HTML_TAG.test(body)) throw new AppError(400, 'validation_failed', 'Metin HTML içeremez; Markdown kullanın');
  }
}
