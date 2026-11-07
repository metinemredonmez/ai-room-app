import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard, UserGuard } from '../auth/tokens.service.js';
import { LOCALES } from '../catalog/catalog.data.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { FeaturesService } from '../features/features.service.js';
import { SPEAK_MAX_CHARS, VOICE_PROVIDERS } from './coach.rules.js';
import { CoachService } from './coach.service.js';

// API.md §7.54. The coach reads only its own replies aloud (the reply's `speakToken` from POST /v1/chat), within the
// day's listening allowance; the audio is served from private storage through a signed, expiring link.

const SpeakSchema = z
  .object({
    text: z.string().min(1).max(SPEAK_MAX_CHARS),
    token: z.string().min(1).max(80),
    locale: z.enum(LOCALES),
  })
  .strict();
const PreviewSchema = z.object({ locale: z.enum(['tr', 'en']), provider: z.enum(VOICE_PROVIDERS) }).strict();

const SpokenReply = {
  type: 'object',
  properties: { url: { type: 'string' }, seconds: { type: 'integer' }, mime: { type: 'string' }, cached: { type: 'boolean' } },
} as const;

@ApiTags('user')
@ApiBearerAuth('user')
@Controller('v1/coach')
@UseGuards(UserGuard)
export class CoachController {
  constructor(private coach: CoachService, private features: FeaturesService, private limiter: RateLimiter) {}

  @Get('quota')
  @Header('Cache-Control', 'no-store')
  @Doc("Koçla bugünkü hak: mesaj ve dinleme saniyesi (İstanbul günü)", { errors: [401] })
  quota(@Auth() auth: AuthContext) {
    return this.coach.quota(auth.userId);
  }

  @Post('speak')
  @HttpCode(200)
  @Doc('Koçun cevabını sesli oku', {
    body: SpeakSchema,
    response: SpokenReply,
    description:
      'Yalnız `POST /v1/chat` cevabındaki `speakToken` ile, aynı metin ve dil için (24 saat). Dinleme saniyesi günlük haktan düşer; ses üretilemezse iade edilir. ' +
      'Hatalar: 403 `speak_forbidden`, 429 `coach_quota` (panel metni), 503 `voice_disabled` | `voice_unassigned`, 502 `voice_unavailable`.',
    errors: [400, 401, 403, 404, 429, 502, 503],
  })
  async speak(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(SpeakSchema, body);
    this.features.assert('assistant_chat');
    await this.limiter.hit(LIMITS.coachSpeak, auth.userId);
    return this.coach.speak(auth.userId, input, req.id);
  }
}

@ApiTags('public')
@Controller('v1/coach')
export class CoachAudioController {
  constructor(private coach: CoachService) {}

  /** FIL-04 / AZ-01: the signature is the capability for this one file; it expires within about an hour. */
  @Get('audio/:key')
  @Doc('Koçun sesi (imzalı bağlantı: `exp` + `sig`); tarayıcı ve telefon oynatıcıları için parça (Range) isteği desteklenir', {
    produces: 'audio/mpeg',
    errors: [403, 404, 416],
  })
  async audio(
    @Param('key') key: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Req() req: AppRequest,
    @Res() res: Response,
  ) {
    if (!this.coach.verifyAudio(key, exp, sig)) throw new AppError(403, 'forbidden', 'Bağlantının süresi dolmuş veya geçersiz');
    const file = await this.coach.readAudio(key);
    if (!file) throw new AppError(404, 'not_found', 'Ses bulunamadı');
    const total = file.body.length;
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Disposition', 'inline');
    // Safari and AVPlayer ask for byte ranges before they play; one range is enough for them.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : total - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : total - 1;
      start = Math.max(0, start);
      end = Math.min(end, total - 1);
      if (start > end || start >= total) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`);
        res.end();
        return;
      }
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
      res.end(file.body.subarray(start, end + 1));
      return;
    }
    res.setHeader('Content-Length', String(total));
    res.end(file.body);
  }
}

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/coach')
@UseGuards(AdminGuard)
export class AdminCoachController {
  constructor(private coach: CoachService, private audit: AuditService, private limiter: RateLimiter) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Koç sesi durumu: anahtarı olan sağlayıcılar, dile göre atanmış sesler, önbellek, son 30 gün ses maliyeti', { errors: [401, 403] })
  status() {
    return this.coach.status();
  }

  @MinRole('ADMIN')
  @Post('preview')
  @HttpCode(200)
  @Doc('Kayıtlı sesi örnek cümleyle dinle (sağlayıcı ve dil seçilir)', { body: PreviewSchema, response: SpokenReply, errors: [400, 401, 403, 429, 502] })
  async preview(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(PreviewSchema, body);
    await this.limiter.hit(LIMITS.coachPreview, auth.userId);
    const out = await this.coach.preview(auth.userId, input.locale, input.provider, req.id);
    if (!out.cached) await this.audit.record(auth.userId, 'coach.voice_preview', 'settings', 'coach', input, req.clientIp);
    return out;
  }
}
