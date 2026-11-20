import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TokensService } from '../auth/tokens.service.js';
import { parse } from '../common/errors.js';
import { Req, type AppRequest } from '../common/http.js';
import { RateLimiter, type Limit } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { AppEventsService } from './app-events.service.js';
import { TrackEventBody } from './app-events.schema.js';

// Public on purpose (a visitor may not be signed in yet). NET / RES-01: the per-IP budget uses the proxy-checked
// client address (req.clientIp), never a raw X-Forwarded-For a caller could invent; a valid session adds a per-user
// budget and links the event, anything else is anonymous.
const EVENT_IP: Limit = { name: 'event-ip', max: 120, windowSec: 60 };
const EVENT_USER: Limit = { name: 'event-user', max: 300, windowSec: 60 };

@ApiTags('events')
@Controller('v1/events')
export class AppEventsController {
  constructor(
    private events: AppEventsService,
    private rate: RateLimiter,
    private tokens: TokensService,
  ) {}

  @Post()
  @HttpCode(201)
  @Doc('Uygulama içi olay kaydet', {
    body: TrackEventBody,
    status: 201,
    description: 'Kimliksiz de gönderilebilir; geçerli oturum varsa kullanıcıya bağlanır. Yalnız beyaz listedeki adlar; `meta` en çok 8 kısa alan.',
    errors: [400, 429],
  })
  async track(@Body() body: unknown, @Req() req: AppRequest) {
    const data = parse(TrackEventBody, body);
    await this.rate.hit(EVENT_IP, req.clientIp);
    const userId = await this.tokens.optionalUserId(req.headers.authorization);
    if (userId) await this.rate.hit(EVENT_USER, userId);
    await this.events.track({ userId, name: data.name, platform: data.platform, version: data.version, sessionId: data.sessionId, meta: data.meta });
    return { ok: true };
  }
}
