import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { requestContext } from './common/http.js';
import { log } from './common/log.js';
import { CONFIG, type Config } from './config.js';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  const cfg = app.get<Config>(CONFIG);

  app.disable('x-powered-by');
  app.use(requestContext(cfg.TRUSTED_PROXY_HOPS));
  // A JSON API: deny everything a browser could render, frame or sniff.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: cfg.isProd,
    }),
  );
  app.enableCors({
    origin: cfg.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept-Language', 'X-Request-Id'],
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
    credentials: false,
    maxAge: 600,
  });
  app.useBodyParser('json', { limit: '15mb' }); // base64 uploads (≤ 10 MB decoded)
  app.enableShutdownHooks();
  return { app, cfg };
}

if (process.env.NODE_ENV !== 'test') {
  const { app, cfg } = await createApp();
  await app.listen(cfg.PORT);
  log.info('backend_started', { port: cfg.PORT, env: cfg.NODE_ENV });
}
