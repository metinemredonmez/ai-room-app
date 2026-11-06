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
import { OrgsController } from './orgs/orgs.controller.js';
import { OrgsService } from './orgs/orgs.service.js';
import { ProjectsService } from './orgs/projects.service.js';
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
import { AdminProductController } from './catalog/product-admin.controller.js';
import { ProductCatalogService } from './catalog/product.service.js';
import { AdminPromptsController } from './prompts/prompts-admin.controller.js';
import { AdminEngineController } from './ai/engine-admin.controller.js';
import { EngineService } from './ai/engine.service.js';
import { AdminFeaturesController, FeaturesController } from './features/features.controller.js';
import { FeaturesService } from './features/features.service.js';
import { AdminThemeController, ThemeController } from './theme/theme.controller.js';
import { ThemeService } from './theme/theme.service.js';
import { AdminLoyaltyController } from './loyalty/loyalty.controller.js';
import { LoyaltyService } from './loyalty/loyalty.service.js';
import { AdminPriceScheduleController } from './prices/price-schedule.controller.js';
import { PriceScheduleService } from './prices/price-schedule.service.js';
import { AdminSessionsController, SessionsController } from './auth/sessions.controller.js';
import { SessionsService } from './auth/sessions.service.js';
import { TotpSecretsService } from './admin/totp-secrets.service.js';
import { AdminReviewAccountController } from './admin/review-account.controller.js';
import { ReviewAccountService } from './admin/review-account.service.js';
import { AdminPromoController, PromoController } from './promo/promo.controller.js';
import { PromoService } from './promo/promo.service.js';
import { AdminReferralController, ReferralController } from './referral/referral.controller.js';
import { ReferralService } from './referral/referral.service.js';
import { AdminGiftController } from './gifts/gift.controller.js';
import { GiftService } from './gifts/gift.service.js';
import { AdminGiftCampaignController } from './gifts/campaign.controller.js';
import { GiftCampaignService } from './gifts/campaign.service.js';
import { AdminPartnersController, AttributionController, PartnersPublicController } from './partners/partners.controller.js';
import { PartnersService } from './partners/partners.service.js';
import { PromptTemplatesService } from './prompts/prompts.service.js';
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
  controllers: [PublicController, AuthController, AdminAuthController, UserController, AdminController, AdminSelfController, AdminsController, BillingController, AppleWebhookController, LegalController, DataRequestsController, AdminLegalController, AdminDataRequestsController, AdminBroadcastsController, BroadcastsController, UnsubscribeController, AdminMarketingController, BlogController, AdminBlogController, SupportController, AdminSupportController, AdminAnalyticsController, AdminPlansController, AdminSubscriptionsController, AdminOrgsController, OrgsController, AdminProductController, AdminPromptsController, AdminEngineController, FeaturesController, AdminFeaturesController, PromoController, AdminPromoController, ReferralController, AdminReferralController, AdminGiftController, AdminGiftCampaignController, PartnersPublicController, AttributionController, AdminPartnersController, ThemeController, AdminThemeController, AdminLoyaltyController, AdminPriceScheduleController, SessionsController, AdminSessionsController, AdminReviewAccountController],
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
    ProjectsService,
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
    ProductCatalogService,
    PromptTemplatesService,
    EngineService,
    FeaturesService,
    ThemeService,
    LoyaltyService,
    PriceScheduleService,
    SessionsService,
    TotpSecretsService,
    ReviewAccountService,
    PromoService,
    ReferralService,
    GiftService,
    GiftCampaignService,
    PartnersService,
    ImagesService,
    AiClient,
    DesignsService,
  ],
})
export class AppModule {}
