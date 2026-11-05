import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma } from '../generated/prisma/client.js';
import { AiClient, type EngineCatalog, type EngineChoice } from './ai.client.js';

// Image engine from the admin (API.md §7.27): which providers are tried, in which order, with which model. The AI
// service says what is possible (a provider with a key, models the server allows); the panel chooses among them.
// One Setting row (`ai.engine`); no row = the server's own chain. Held in memory, refreshed every 15 s.

const KEY = 'ai.engine';
const REFRESH_MS = 15_000;
const PROVIDER = /^[a-z]{2,20}$/;

export const EngineInputSchema = z
  .object({
    chain: z.array(z.string().regex(PROVIDER)).min(1).max(4),
    models: z.record(z.string().regex(PROVIDER), z.string().min(1).max(120)).default({}),
  })
  .strict();

/** Why a choice cannot be saved, in Turkish; empty = fine. Checked against what the AI service reports now. */
export function engineIssues(choice: EngineChoice, catalog: EngineCatalog): string[] {
  const out: string[] = [];
  const by = new Map(catalog.providers.map((p) => [p.name, p]));
  if (new Set(choice.chain).size !== choice.chain.length) out.push('bir sağlayıcı zincirde bir kez olabilir');
  for (const name of choice.chain) {
    const p = by.get(name);
    if (!p) out.push(`“${name}” diye bir sağlayıcı yok`);
    else if (!p.usable) out.push(`${name}: sunucuda anahtarı yok ya da burada kullanılamaz`);
  }
  for (const [name, model] of Object.entries(choice.models)) {
    if (!choice.chain.includes(name)) out.push(`${name}: zincirde olmayan sağlayıcıya model seçilemez`);
    else if (!by.get(name)?.models.some((m) => m.id === model)) out.push(`${name}: “${model}” izinli modeller arasında değil`);
  }
  return out;
}

export function parseEngine(value: unknown): EngineChoice | null {
  const r = EngineInputSchema.safeParse(value);
  return r.success ? r.data : null;
}

@Injectable()
export class EngineService implements OnModuleInit, OnModuleDestroy {
  private value: EngineChoice | null = null;
  private meta: { updatedAt: Date | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null };
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService, private ai: AiClient) {}

  async onModuleInit() {
    await this.reload().catch((e: Error) => log.warn('engine_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reload() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    this.value = row ? parseEngine(row.value) : null;
    if (row && !this.value) log.error('engine_setting_invalid', { key: KEY });
    this.meta = { updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  }

  /** For a generation; undefined = the AI service's own chain. */
  get current(): EngineChoice | undefined {
    return this.value ?? undefined;
  }

  async forAdmin() {
    await this.reload();
    const [catalog, editor] = await Promise.all([
      this.ai.engineCatalog(),
      this.meta.updatedBy ? this.prisma.user.findUnique({ where: { id: this.meta.updatedBy }, select: { name: true, email: true } }) : null,
    ]);
    return {
      choice: this.value,
      // A saved choice the server can no longer honour is ignored there; the panel says so.
      ignored: this.value ? engineIssues(this.value, catalog) : [],
      catalog,
      version: this.meta.updatedAt?.toISOString() ?? null,
      updatedAt: this.meta.updatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.name ?? editor.email) : null,
    };
  }

  /** `choice: null` returns to the server's chain. Fail-closed: without the AI service's catalog nothing is saved. */
  async save(choice: EngineChoice | null, version: string | null, actorId: string) {
    if (choice) {
      const issues = engineIssues(choice, await this.ai.engineCatalog());
      if (issues.length) throw new AppError(400, 'invalid_engine', `Kaydedilemedi — ${issues.slice(0, 3).join('; ')}`, {}, { issues });
    }
    const previous = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      if ((row?.updatedAt.toISOString() ?? null) !== version) {
        throw new AppError(409, 'version_conflict', 'Ayar bu arada değişti; sayfayı yenileyip yeniden dene.');
      }
      if (choice) {
        const value = choice as unknown as Prisma.InputJsonValue;
        await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      } else if (row) {
        await tx.setting.delete({ where: { key: KEY } });
      }
      return row ? parseEngine(row.value) : null;
    });
    await this.reload();
    return { previous };
  }
}
