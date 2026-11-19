import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { jwtVerify } from 'jose';
import { AUD_APP } from '../auth/tokens.service.js';
import { parse } from '../common/errors.js';
import { RateLimiter, type Limit } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { AppEventsService } from './app-events.service.js';
import { TrackEventBody } from './app-events.schema.js';
import { CONFIG, type Config } from '../config.js';

const EVENT_IP: Limit = { name: 'event-ip', max: 120, windowSec: 60 };
const EVENT_USER: Limit = { name: 'event-user', max: 300, windowSec: 60 };

@ApiTags('events')
@Controller('v1/events')
export class AppEventsController {
  constructor(
    private events: AppEventsService,
    private rate: RateLimiter,
    @Inject(CONFIG) private cfg: Config,
  ) {}

  @Post()
  @Doc('Uygulama içi olay kaydet', {
    description: 'Kimliksiz de gönderilebilir; token varsa kullanıcıya bağlanır. Beyaz listedeki name değerleri kabul edilir.',
    errors: [400, 429],
  })
  async track(
    @Body() body: unknown,
    @Headers('authorization') authHeader: string | undefined,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('x-real-ip') realIp: string | undefined,
  ) {
    const data = parse(TrackEventBody, body);
    const ip = (forwardedFor ?? realIp ?? 'unknown').split(',')[0].trim();
    await this.rate.hit(EVENT_IP, ip);

    let userId: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { payload } = await jwtVerify(authHeader.slice(7), new TextEncoder().encode(this.cfg.JWT_SECRET), {
          algorithms: ['HS256'],
          issuer: 'casalume',
          audience: AUD_APP,
        });
        if (payload.typ === 'access' && typeof payload.sub === 'string') {
          userId = payload.sub;
          await this.rate.hit(EVENT_USER, userId);
        }
      } catch {
        // ignore invalid bearer, treat as anonymous
      }
    }

    await this.events.track({
      userId,
      name: data.name,
      platform: data.platform,
      version: data.version,
      sessionId: data.sessionId,
      meta: data.meta,
    });

    return { ok: true };
  }
}
