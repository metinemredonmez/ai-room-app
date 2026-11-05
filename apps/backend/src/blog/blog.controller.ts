import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { isLocale } from '../catalog/catalog.data.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { SLUG_RE } from '../marketing/marketing.rules.js';
import { BlogService } from './blog.service.js';
import { FeaturesService } from '../features/features.service.js';

const localeOrTr = (l: unknown) => (isLocale(l) ? l : 'tr');

/** Public blog and SEO texts (API.md §7.18): published articles only; the web caches these for a few minutes. */
@ApiTags('public')
@Controller('v1')
export class BlogController {
  constructor(private blog: BlogService, private features: FeaturesService) {}

  /** API.md §7.28: with the blog switched off, its pages answer 404 and the sitemap lists none. */
  private assertOn() {
    if (!this.features.enabled('blog')) throw new AppError(404, 'not_found', 'Blog şu an kapalı');
  }

  @Get('blog')
  @Doc('Yayındaki blog yazıları', { description: '`?locale=` (11 dil), yeniden eskiye, en çok 100.' })
  list(@Query('locale') locale?: string) {
    this.assertOn();
    return this.blog.listPublic(localeOrTr(locale));
  }

  @Get('blog/sitemap')
  @Doc('Site haritası için bütün yayındaki yazılar (dil, adres, çeviri grubu)')
  sitemap() {
    if (!this.features.enabled('blog')) return { items: [] };
    return this.blog.sitemap();
  }

  @Get('blog/:slug')
  @Doc('Blog yazısı', { description: '`?locale=`; gövde Markdown alt kümesi; `translations` hreflang için.', errors: [404] })
  get(@Param('slug') slug: string, @Query('locale') locale?: string) {
    if (!SLUG_RE.test(slug) || slug.length > 80) throw new AppError(404, 'not_found', 'Yazı bulunamadı');
    this.assertOn();
    return this.blog.getPublic(localeOrTr(locale), slug);
  }

  @Get('seo/meta')
  @Doc('Onaylı sayfa başlıkları ve açıklamaları', { description: '`?locale=` → `{ pages: { home: { title, description }, … } }`; onaylı yoksa boş.' })
  seo(@Query('locale') locale?: string) {
    return this.blog.seoMeta(String(locale ?? 'tr'));
  }
}

/** Blog management: articles are published by approving a marketing draft; here they can be taken down or back. */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/blog')
@UseGuards(AdminGuard)
export class AdminBlogController {
  constructor(private blog: BlogService, private audit: AuditService) {}

  @Get()
  @MinRole('EDITOR')
  @Doc('Blog yazıları (yayında ve yayından kaldırılmış)', { errors: [401, 403] })
  list() {
    return this.blog.adminList();
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @MinRole('ADMIN')
  @Doc('Yazıyı yayından kaldır', { errors: [401, 403, 404] })
  async unpublish(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    const out = await this.blog.setStatus(parse(z.uuid(), id), 'DRAFT');
    await this.audit.record(auth.userId, 'blog.unpublish', 'blog', out.id, { locale: out.locale, slug: out.slug }, req.clientIp);
    return out;
  }

  @Post(':id/publish')
  @HttpCode(200)
  @MinRole('ADMIN')
  @Doc('Yazıyı yeniden yayınla', { errors: [401, 403, 404] })
  async publish(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    const out = await this.blog.setStatus(parse(z.uuid(), id), 'PUBLISHED');
    await this.audit.record(auth.userId, 'blog.publish', 'blog', out.id, { locale: out.locale, slug: out.slug }, req.clientIp);
    return out;
  }
}
