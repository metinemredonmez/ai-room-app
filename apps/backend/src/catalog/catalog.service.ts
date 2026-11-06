import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CONFIG, type Config } from '../config.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import type { Style } from '../generated/prisma/client.js';
import { SAMPLES_VERSION, loadSample } from '../images/samples.js';
import { LegalService } from '../kvkk/legal.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PlansService } from '../billing/plans.service.js';
import type { Locale } from './catalog.data.js';
import { localize } from './catalog.i18n.js';
import { ProductCatalogService } from './product.service.js';
import { FeaturesService } from '../features/features.service.js';

// Curated style photos (assets/styles/<id>.jpg): the sample living room redesigned in that style with the
// production image model. src/catalog and dist/catalog both resolve to apps/backend/assets. Bump the version
// when the photos change so cached previews are rebuilt.
const STYLE_PHOTOS = fileURLToPath(new URL('../../assets/styles/', import.meta.url));
const STYLE_PHOTOS_VERSION = 'nb2-1';

@Injectable()
export class CatalogService {
  private cache: { at: number; styles: Style[] } | null = null;

  constructor(
    private prisma: PrismaService, private settings: SettingsService, private legal: LegalService, @Inject(CONFIG) private cfg: Config, private plans: PlansService,
    private product: ProductCatalogService,
    private features: FeaturesService,
  ) {}

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
    return localize(locale, `styles.${s.id}.name`, { tr: s.nameTr, en: s.nameEn });
  }

  previewUrl(id: string) {
    return `${this.cfg.PUBLIC_BASE_URL}/v1/styles/${id}/preview.jpg`;
  }

  /** The admin's tools, rooms, floors and colours (API.md §7.25), for texts that describe the product. */
  get productCatalog() {
    return this.product.current;
  }

  async catalog(locale: Locale) {
    const styles = await this.styles();
    // Tools, rooms, floors and colours as the admin set them (API.md §7.25): offered ones only, in the panel's order.
    const product = this.product.forApp(locale);
    return {
      tools: product.tools,
      styles: styles.map((s) => ({
        id: s.id,
        name: this.styleName(s, locale),
        description: localize(locale, `styles.${s.id}.description`, { tr: s.descriptionTr, en: s.descriptionEn }),
        palette: s.palette,
        isPro: s.isPro,
        previewUrl: this.previewUrl(s.id),
      })),
      rooms: product.rooms,
      floors: product.floors,
      colors: product.colors,
      // Plan cards and the web pricing page from the admin's plans catalog (API.md §7.21, §7.50).
      ...(await this.plans.forCatalog(locale)),
      // Packs on sale from the plans catalog (API.md §7.21), one row per store product id.
      creditPacks: (await this.plans.forPaywall('en')).packs.flatMap((p) =>
        [...new Set([p.productIds.ios, p.productIds.android])].filter((id): id is string => !!id).map((productId) => ({ productId, credits: p.credits })),
      ),
      /** Feature flags (API.md §7.28), also at GET /v1/features. */
      features: this.features.current,
      /** Credits a new registered, verified account gets once; 0 = off (API.md §7.22). */
      welcomeCredits: this.settings.current.welcomeCredits,
      ...this.notices(locale),
      legal: {
        termsVersion: this.legal.versionOf('terms').version, privacyVersion: this.legal.versionOf('privacy').version,
        aiProcessingVersion: this.legal.versionOf('ai_processing').version, marketingVersion: this.legal.versionOf('marketing').version,
      },
    };
  }

  private notices(locale: Locale) {
    const { announcement, maintenance } = this.settings.current;
    const en = locale !== 'tr'; // admin texts are Turkish and English; other languages read the English one
    return {
      announcement: announcement.enabled ? (en ? announcement.textEn || announcement.textTr : announcement.textTr) || null : null,
      maintenance: { enabled: maintenance.enabled, message: maintenance.enabled ? (en ? maintenance.messageEn : maintenance.messageTr) : '' },
    };
  }

  /**
   * Style preview, cached on disk; public, contains no user data. A curated photo when the style has one,
   * otherwise (e.g. a style added in the admin) the sample living room tinted with the style's palette.
   */
  async preview(id: string): Promise<Buffer> {
    if (!/^[a-z_]{2,40}$/.test(id)) throw new AppError(404, 'not_found', 'Bulunamadı');
    const style = (await this.styles(true)).find((s) => s.id === id);
    if (!style) throw new AppError(404, 'not_found', 'Bulunamadı');
    const dir = path.resolve(this.cfg.DATA_DIR, 'previews');
    const curated = await readFile(path.join(STYLE_PHOTOS, `${id}.jpg`)).catch(() => null);
    const key = curated
      ? `${id}-${STYLE_PHOTOS_VERSION}.jpg`
      : `${id}-${SAMPLES_VERSION}-${style.palette.join('').replace(/#/g, '')}.jpg`;
    const file = path.join(dir, key);
    try {
      return await readFile(file);
    } catch {
      await mkdir(dir, { recursive: true });
      if (curated) {
        const buf = await sharp(curated).resize(640).jpeg({ quality: 82 }).toBuffer();
        await writeFile(file, buf);
        return buf;
      }
      const base = await loadSample('living_room');
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
