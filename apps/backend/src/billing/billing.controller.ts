import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserGuard } from '../auth/tokens.service.js';
import { Doc } from '../common/openapi.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { log } from '../common/log.js';
import { UsersService } from '../users/users.service.js';
import { BillingService } from './billing.service.js';

@ApiTags('billing')
@Controller('v1')
export class BillingController {
  constructor(private billing: BillingService, private users: UsersService, private limiter: RateLimiter) {}

  /** RevenueCat → us. Authenticated before any write; 200 fast, processing happens on the queue. */
  @Doc('RevenueCat webhook (Authorization ve/veya X-RevenueCat-Webhook-Signature HMAC zorunlu)', {
    description: 'Önce kimlik doğrulanır, sonra olay `id` ile bir kez kaydedilir; tekrar gelen olay yeniden işlenmez. İşleme kuyrukta yapılır ve RevenueCat REST ile abone durumu eşitlenir.',
    errors: [400, 401, 404, 429],
  })
  @Post('webhooks/revenuecat')
  @HttpCode(200)
  async revenuecat(@Req() req: AppRequest & { rawBody?: Buffer }, @Body() body: unknown) {
    await this.limiter.hit(LIMITS.webhooks, req.clientIp);
    this.billing.verify(req.headers, req.rawBody);
    const result = await this.billing.receive(body);
    log.info('billing_webhook', { result, ip: req.clientIp });
    return { ok: true, result };
  }

  /** Called by the app right after a purchase/restore so access updates without waiting for the webhook. */
  @ApiBearerAuth('user')
  @Doc('Satın alma sonrası abonelik durumunu RevenueCat ile eşitle', { status: 201, response: 'User', errors: [401, 429, 502] })
  @Post('billing/sync')
  @UseGuards(UserGuard)
  async sync(@Auth() auth: AuthContext) {
    await this.limiter.hit(LIMITS.billingSync, auth.userId);
    await this.billing.syncFromRest(auth.userId).catch((e: Error) => {
      log.warn('billing_sync_failed', { userId: auth.userId, error: e.message });
    });
    return this.users.toDto(await this.users.get(auth.userId));
  }
}
