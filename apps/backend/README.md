# Casalume — Backend (NestJS)

Ana API: kimlik doğrulama (misafir / e-posta / admin TOTP), tasarım üretimi, kredi ve kota, görsel
deposu (imzalı URL), katalog, sohbet, analiz ve admin uçları. Sözleşme: [`docs/API.md`](../../docs/API.md).

## Çalıştırma

```bash
cp .env.example .env     # DATABASE_URL + JWT_SECRET, IMAGE_URL_SECRET, DEVICE_PEPPER, AI_INTERNAL_TOKEN (her biri ≥ 32 karakter, farklı)
npm install              # postinstall: prisma generate
npx prisma migrate deploy
npm run db:seed          # stiller + admin (bilgiler data/admin-credentials.txt, mod 600)
npm run build && npm run start:prod      # http://localhost:4000/v1/health
```

Geliştirme: `npm run start:dev` · admin TOTP kodu: `npm run admin:otp` (yalnız geliştirme).

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm test` | Vitest birim testleri (TOTP RFC 6238, NET-03, MIME imzası, KEY-01) |
| `npm run test:e2e` | `scripts/smoke.mjs` — çalışan yığına karşı 27 uçtan uca kontrol |
| `npm run lint` / `npm run typecheck` | oxlint (type-aware) / tsc |
| `npm run db:migrate` / `npm run db:seed` | Prisma migrate deploy / seed |

## Yapı

```
src/
  main.ts, app.module.ts, config.ts      # açılış, helmet, CORS, gövde limiti, zod ile ortam doğrulama
  common/      errors (fail-closed filtre), http (istek kimliği, NET-03 IP), infra (Prisma, Redis, RateLimiter, Semaphore), log
  auth/        crypto (Argon2id, TOTP), tokens.service (JWT, refresh rotasyonu, guard'lar), auth.controller
  users/       DTO, kota ve kredi (satır kilitli düşüm/iade)
  catalog/     araçlar, odalar, zeminler, renkler, planlar; stiller DB'de
  images/      normalize/sniff/watermark/imzalı URL, örnek sahneler
  designs/     üretim akışı, liste, analiz (TL toplamları + mağaza linkleri)
  ai/          iç AI servisi istemcisi
  admin/       istatistik, kullanıcı, tasarım, stil, denetim, sistem
prisma/        schema.prisma, migrations, seed.ts
```
