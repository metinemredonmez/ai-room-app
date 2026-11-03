import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { COMPONENTS } from './common/openapi.js';
import { requestContext } from './common/http.js';
import { log } from './common/log.js';
import { CONFIG, type Config } from './config.js';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, rawBody: true, logger: ['error', 'warn'] });
  const cfg = app.get<Config>(CONFIG);

  app.disable('x-powered-by');
  app.use(requestContext(cfg.TRUSTED_PROXY_HOPS));
  // A JSON API: deny everything a browser could render, frame or sniff. Only the Swagger UI (dev by
  // default) gets a policy that lets its own bundled scripts and styles load.
  const apiHelmet = helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: cfg.isProd,
  });
  const docsHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"],
      },
    },
    hsts: cfg.isProd,
  });
  app.use((req: { path: string }, res: unknown, next: () => void) =>
    (cfg.swaggerEnabled && req.path.startsWith('/docs') ? docsHelmet : apiHelmet)(req as never, res as never, next),
  );
  app.enableCors({
    origin: cfg.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept-Language', 'X-Request-Id'],
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
    credentials: false,
    maxAge: 600,
  });
  app.useBodyParser('json', { limit: '15mb' }); // base64 uploads (≤ 10 MB decoded); raw body kept for webhook HMAC
  app.enableShutdownHooks();

  if (cfg.swaggerEnabled) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('AI Room API')
        .setDescription(
          'AI Room backend (NestJS). Sözleşme: docs/API.md. Kullanıcı uçları `user`, yönetim uçları `admin` (parola + TOTP ile alınan) Bearer token ister. ' +
            'Hata gövdesi her zaman `{ error: { code, message } }`. Bu sayfa üretimde varsayılan olarak kapalıdır (SWAGGER_ENABLED).',
        )
        .setVersion(process.env.npm_package_version ?? '0.1.0')
        .addServer(cfg.PUBLIC_BASE_URL)
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'aud=ai-room-app' }, 'user')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'aud=ai-room-admin, MFA tamam' }, 'admin')
        .build(),
    );
    doc.components = { ...doc.components, schemas: Object.assign({}, doc.components?.schemas, COMPONENTS) };
    SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: 'docs/openapi.json', customSiteTitle: 'AI Room API' });
  }
  return { app, cfg };
}

if (process.env.NODE_ENV !== 'test') {
  const { app, cfg } = await createApp();
  await app.listen(cfg.PORT);
  log.info('backend_started', { port: cfg.PORT, env: cfg.NODE_ENV });
}
