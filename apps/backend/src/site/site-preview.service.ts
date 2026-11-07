import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type Config } from '../config.js';
import { PrismaService } from '../common/infra.js';
import { SettingsService } from '../settings/settings.service.js';

// API.md §7.52: the web site's maintenance page and the staff preview link (MAEYJA pattern).
// The link carries 32 random bytes in its fragment (never in a server log or a Referer, like the reset link, AUT-03);
// only their SHA-256 is stored, so a database read does not give a working link. A new link replaces the old one.

const KEY = 'site.preview';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const Stored = z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/) });

const sha256 = (s: string) => createHash('sha256').update(s).digest();

export interface SitePreviewInfo {
  active: boolean;
  createdAt: string | null;
  createdBy: { id: string; email: string | null; name: string | null } | null;
}

@Injectable()
export class SitePreviewService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    @Inject(CONFIG) private cfg: Config,
  ) {}

  /** What the web's proxy reads before every page (it keeps the answer for a few seconds). */
  get status() {
    const m = this.settings.current.maintenance;
    return { maintenance: m.site, messageTr: m.site ? m.messageTr : '', messageEn: m.site ? m.messageEn : '' };
  }

  async verify(token: string): Promise<boolean> {
    if (!TOKEN_RE.test(token)) return false;
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const stored = Stored.safeParse(row?.value);
    if (!stored.success) return false;
    return timingSafeEqual(sha256(token), Buffer.from(stored.data.hash, 'hex'));
  }

  async info(): Promise<SitePreviewInfo> {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    if (!row || !Stored.safeParse(row.value).success) return { active: false, createdAt: null, createdBy: null };
    const by = row.updatedBy ? await this.prisma.user.findUnique({ where: { id: row.updatedBy }, select: { id: true, email: true, name: true } }) : null;
    return { active: true, createdAt: row.updatedAt.toISOString(), createdBy: by };
  }

  /** A new link; the previous one stops working at once. The token is returned only here, never stored. */
  async rotate(actorId: string): Promise<{ url: string; info: SitePreviewInfo }> {
    const token = randomBytes(32).toString('base64url');
    const value = { hash: sha256(token).toString('hex') };
    await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
    return { url: new URL(`/#onizleme=${token}`, this.cfg.WEB_APP_URL).toString(), info: await this.info() };
  }

  /** True when there was a link to cancel. */
  async revoke(): Promise<boolean> {
    const { count } = await this.prisma.setting.deleteMany({ where: { key: KEY } });
    return count > 0;
  }
}
