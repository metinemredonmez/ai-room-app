import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AdminController } from './admin/admin.controller.js';
import { AuditService } from './admin/audit.service.js';
import { AiClient } from './ai/ai.client.js';
import { PublicController, UserController } from './app.controller.js';
import { AdminAuthController, AuthController } from './auth/auth.controller.js';
import { EmailTokensService } from './auth/email-tokens.service.js';
import { AdminGuard, TokensService, UserGuard } from './auth/tokens.service.js';
import { CatalogService } from './catalog/catalog.service.js';
import { ErrorFilter } from './common/errors.js';
import { PrismaService, RateLimiter, RedisService } from './common/infra.js';
import { CONFIG, loadConfig } from './config.js';
import { DesignsService } from './designs/designs.service.js';
import { ImagesService } from './images/images.service.js';
import { MailerService } from './mail/mailer.service.js';
import { UsersService } from './users/users.service.js';

@Module({
  controllers: [PublicController, AuthController, AdminAuthController, UserController, AdminController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: APP_FILTER, useClass: ErrorFilter },
    PrismaService,
    RedisService,
    RateLimiter,
    TokensService,
    MailerService,
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
