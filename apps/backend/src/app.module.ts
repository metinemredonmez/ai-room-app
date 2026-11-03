import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AdminController } from './admin/admin.controller.js';
import { AuditService } from './admin/audit.service.js';
import { AiClient } from './ai/ai.client.js';
import { PublicController, UserController } from './app.controller.js';
import { AdminAuthController, AuthController } from './auth/auth.controller.js';
import { EmailTokensService } from './auth/email-tokens.service.js';
import { AdminGuard, TokensService, UserGuard } from './auth/tokens.service.js';
import { BillingController } from './billing/billing.controller.js';
import { BillingService } from './billing/billing.service.js';
import { CatalogService } from './catalog/catalog.service.js';
import { ErrorFilter } from './common/errors.js';
import { PrismaService, RateLimiter, RedisService } from './common/infra.js';
import { CONFIG, loadConfig } from './config.js';
import { DesignsService } from './designs/designs.service.js';
import { ImagesService } from './images/images.service.js';
import { JobsService } from './jobs/jobs.service.js';
import { QueuesService } from './jobs/queues.service.js';
import { ConsentsService } from './kvkk/consents.service.js';
import { MailerService } from './mail/mailer.service.js';
import { PushService } from './push/push.service.js';
import { SettingsService } from './settings/settings.service.js';
import { UsageService } from './usage/usage.service.js';
import { UsersService } from './users/users.service.js';

@Module({
  controllers: [PublicController, AuthController, AdminAuthController, UserController, AdminController, BillingController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: APP_FILTER, useClass: ErrorFilter },
    PrismaService,
    RedisService,
    SettingsService,
    UsageService,
    QueuesService,
    ConsentsService,
    BillingService,
    JobsService,
    RateLimiter,
    TokensService,
    MailerService,
    PushService,
    EmailTokensService,
    UserGuard,
    AdminGuard,
    UsersService,
    AuditService,
    CatalogService,
    ImagesService,
    AiClient,
    DesignsService,
  ],
})
export class AppModule {}
