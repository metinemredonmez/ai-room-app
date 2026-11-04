import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AdminController } from './admin/admin.controller.js';
import { AdminAnalyticsController } from './admin/analytics.controller.js';
import { AnalyticsService } from './admin/analytics.service.js';
import { AuditService } from './admin/audit.service.js';
import { AdminSecurityService } from './admin/admin-security.service.js';
import { AdminSelfController, AdminsController } from './admin/admins.controller.js';
import { AiClient } from './ai/ai.client.js';
import { PublicController, UserController } from './app.controller.js';
import { AdminAuthController, AppleWebhookController, AuthController } from './auth/auth.controller.js';
import { AppleService } from './auth/apple.service.js';
import { OAuthService } from './auth/oauth.service.js';
import { EmailTokensService } from './auth/email-tokens.service.js';
import { AdminGuard, TokensService, UserGuard } from './auth/tokens.service.js';
import { BillingController } from './billing/billing.controller.js';
import { AdminPlansController, AdminSubscriptionsController } from './billing/billing-admin.controller.js';
import { PlansService } from './billing/plans.service.js';
import { WelcomeService } from './users/welcome.service.js';
import { AdminOrgsController } from './orgs/orgs.admin.controller.js';
import { OrgsService } from './orgs/orgs.service.js';
import { BillingService } from './billing/billing.service.js';
import { AdminBroadcastsController, BroadcastsController, UnsubscribeController } from './broadcasts/broadcasts.controller.js';
import { BroadcastsService } from './broadcasts/broadcasts.service.js';
import { AdminMarketingController } from './marketing/marketing.controller.js';
import { AdminBlogController, BlogController } from './blog/blog.controller.js';
import { AdminSupportController, SupportController } from './support/support.controller.js';
import { SupportService } from './support/support.service.js';
import { BlogService } from './blog/blog.service.js';
import { MarketingService } from './marketing/marketing.service.js';
import { CatalogService } from './catalog/catalog.service.js';
import { VersionGate } from './common/app-version.js';
import { ErrorFilter } from './common/errors.js';
import { PrismaService, RateLimiter, RedisService } from './common/infra.js';
import { CONFIG, loadConfig } from './config.js';
import { DesignsService } from './designs/designs.service.js';
import { ImagesService } from './images/images.service.js';
import { JobsService } from './jobs/jobs.service.js';
import { QueuesService } from './jobs/queues.service.js';
import { ConsentsService } from './kvkk/consents.service.js';
import { DataRequestsService } from './kvkk/data-requests.service.js';
import { AdminDataRequestsController, AdminLegalController, DataRequestsController, LegalController } from './kvkk/kvkk.controller.js';
import { LegalService } from './kvkk/legal.service.js';
import { MailerService } from './mail/mailer.service.js';
import { PushService } from './push/push.service.js';
import { SettingsService } from './settings/settings.service.js';
import { UsageService } from './usage/usage.service.js';
import { UsersService } from './users/users.service.js';

@Module({
  controllers: [PublicController, AuthController, AdminAuthController, UserController, AdminController, AdminSelfController, AdminsController, BillingController, AppleWebhookController, LegalController, DataRequestsController, AdminLegalController, AdminDataRequestsController, AdminBroadcastsController, BroadcastsController, UnsubscribeController, AdminMarketingController, BlogController, AdminBlogController, SupportController, AdminSupportController, AdminAnalyticsController, AdminPlansController, AdminSubscriptionsController, AdminOrgsController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: APP_FILTER, useClass: ErrorFilter },
    { provide: APP_GUARD, useClass: VersionGate },
    PrismaService,
    RedisService,
    SettingsService,
    UsageService,
    QueuesService,
    LegalService,
    ConsentsService,
    DataRequestsService,
    BillingService,
    PlansService,
    WelcomeService,
    OrgsService,
    AnalyticsService,
    BroadcastsService,
    MarketingService,
    BlogService,
    SupportService,
    JobsService,
    RateLimiter,
    TokensService,
    MailerService,
    PushService,
    EmailTokensService,
    AppleService,
    OAuthService,
    UserGuard,
    AdminGuard,
    UsersService,
    AuditService,
    AdminSecurityService,
    CatalogService,
    ImagesService,
    AiClient,
    DesignsService,
  ],
})
export class AppModule {}
