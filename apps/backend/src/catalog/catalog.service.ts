import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { CONFIG, type Config } from '../config.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import type { Style } from '../generated/prisma/client.js';
import { loadSample } from '../images/samples.js';
import { COLORS, FLOORS, PLANS, ROOMS, TOOLS, TOOL_IDS, type Locale } from './catalog.data.js';

@Injectable()
export class CatalogService {
  private cache: { at: number; styles: Style[] } | null = null;

  constructor(private prisma: PrismaService, @Inject(CONFIG) private cfg: Config) {}

  async styles(includeInactive = false): Promise<Style[]> {
    if (includeInactive) return this.prisma.style.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    if (!this.cache || Date.now() - this.cache.at > 30_000) {
      const styles = await this.prisma.style.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
      this.cache = { at: Date.now(), styles };
    }
    return this.cache.styles;
  }

  invalidate() {
    this.cache = null;
  }

  async style(id: string): Promise<Style> {
    const s = (await this.styles()).find((x) => x.id === id);
    if (!s) throw new AppError(400, 'validation_failed', 'Geçersiz stil');
    return s;
  }

  styleName(s: Style, locale: Locale) {
    return locale === 'en' ? s.nameEn : s.nameTr;
  }

  previewUrl(id: string) {
    return `${this.cfg.PUBLIC_BASE_URL}/v1/styles/${id}/preview.jpg`;
  }

  async catalog(locale: Locale) {
    const styles = await this.styles();
    return {
      tools: TOOL_IDS.map((id) => {
        const t = TOOLS[id];
        return { id, name: t.name[locale], description: t.description[locale], icon: t.icon, category: t.category, isPro: t.isPro, isNew: t.isNew, needs: t.needs };
      }),
      styles: styles.map((s) => ({
        id: s.id,
        name: this.styleName(s, locale),
        description: locale === 'en' ? s.descriptionEn : s.descriptionTr,
        palette: s.palette,
        isPro: s.isPro,
        previewUrl: this.previewUrl(s.id),
      })),
      rooms: Object.entries(ROOMS).map(([id, r]) => ({ id, name: r.name[locale], icon: r.icon })),
      floors: Object.entries(FLOORS).map(([id, f]) => ({ id, name: f.name[locale] })),
      colors: COLORS.map((c) => ({ id: c.id, name: c.name[locale], hex: c.hex })),
      plans: PLANS.map((p) => ({ id: p.id, name: p.name[locale], period: p.period, priceTRY: p.priceTRY, badge: p.badge?.[locale] ?? null })),
    };
  }

  /** Palette-tinted preview of the sample living room, cached on disk; public, contains no user data. */
  async preview(id: string): Promise<Buffer> {
    if (!/^[a-z_]{2,40}$/.test(id)) throw new AppError(404, 'not_found', 'Bulunamadı');
    const style = (await this.styles(true)).find((s) => s.id === id);
    if (!style) throw new AppError(404, 'not_found', 'Bulunamadı');
    const dir = path.resolve(this.cfg.DATA_DIR, 'previews');
    const key = `${id}-${style.palette.join('').replace(/#/g, '')}.jpg`;
    const file = path.join(dir, key);
    try {
      return await readFile(file);
    } catch {
      await mkdir(dir, { recursive: true });
      const base = await loadSample(this.cfg.DATA_DIR, 'living_room');
      const [c1 = '#cccccc', c2 = c1, c3 = c2, c4 = c3] = style.palette;
      const w = 1280;
      const h = 960;
      const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <rect width="${w}" height="${h}" fill="${c2}" opacity="0.35"/>
        <rect y="${h - 90}" width="${w / 4}" height="90" fill="${c1}"/><rect x="${w / 4}" y="${h - 90}" width="${w / 4}" height="90" fill="${c2}"/>
        <rect x="${w / 2}" y="${h - 90}" width="${w / 4}" height="90" fill="${c3}"/><rect x="${(3 * w) / 4}" y="${h - 90}" width="${w / 4}" height="90" fill="${c4}"/>
      </svg>`);
      // sharp always resizes before compositing, so compose at full size first, then downscale.
      const composed = await sharp(base).modulate({ saturation: 1.1 }).composite([{ input: overlay }]).toBuffer();
      const buf = await sharp(composed).resize(640).jpeg({ quality: 82 }).toBuffer();
      await writeFile(file, buf);
      return buf;
    }
  }
}
