# AI Room — Web uygulaması

Son kullanıcıya dönük Next.js (App Router, Next 16, Tailwind 4) uygulaması. Türkçe öncelikli, EN desteği var.
API sözleşmesi: [`docs/API.md`](../../docs/API.md).

## Çalıştırma

```bash
cd apps/web
cp .env.example .env.local   # gerekirse düzenle
npm install
npm run dev                  # http://localhost:3000
```

Backend'in (`apps/backend`, port 4000) çalışıyor olması gerekir. Üretim derlemesi:

```bash
npm run build && npm start
```

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `API_BASE_URL` | `http://localhost:4000/v1` | Backend taban URL'si. Yalnız sunucu tarafında (BFF) kullanılır. |
| `NEXT_PUBLIC_APP_URL` | — | Uygulamanın dışarıdan görünen origin'i; CSRF için `Origin` kontrolünde kullanılır. |
| `IMAGE_ORIGINS` | — | İmzalı görsel URL'leri farklı bir origin'den (CDN) geliyorsa, virgülle ayrılmış liste. |

## Mimari ve güvenlik

- **BFF (SES-01):** Tarayıcı token görmez. `/api/auth/{guest,login,register,logout}` backend'den aldığı
  access/refresh token'ları `HttpOnly; SameSite=Lax; Secure (prod)` çerezlere yazar; refresh çerezi yalnız `/api` yoluna gider.
- **Proxy:** `/api/v1/*` isteği `API_BASE_URL`'e Bearer token ile iletir, 401'de refresh token'ı bir kez döndürür (rotasyon),
  `auth/`, `admin/`, `images/` köklerini engeller, yalnız güvenli başlıkları geçirir.
- **CSRF (WEB-03):** GET dışındaki tüm BFF uçları `Origin` başlığının uygulamanın kendi origin'i olmasını şart koşar.
- **XSS (WEB-01):** AI ve kullanıcı metni yalnız düz metin olarak render edilir; mağaza linkleri yalnız `http(s)` ise `href` olur.
  CSP, X-Frame-Options/`frame-ancestors 'none'`, `nosniff`, Referrer-Policy `next.config.ts` içinde.
- **İndirme:** `/api/download?src=` yalnız backend'in `/v1/images/<uuid>` yollarını indirir (SSRF koruması).
- İmzalı görsel URL'leri adres çubuğuna konmaz; sayfalar arası aktarım `sessionStorage` ile yapılır.

## Sayfalar

| Yol | İçerik |
|---|---|
| `/` | Tanıtım: önce/sonra animasyonu, özellikler, nasıl çalışır, stiller, fiyatlar, SSS |
| `/giris` | Giriş / kayıt / misafir olarak dene (misafir hesabı kayıtta yükseltilir) |
| `/studio` | Araç → fotoğraf (yükleme ya da örnek) → stil/oda/ayarlar → üretim → önce/sonra, varyantlar, indirme, analiz |
| `/tasarimlarim` | Tasarım listesi, favoriler, silme |
| `/tasarim/[id]` | Tasarım detayı ve analiz (alışveriş listesi, TL bütçe) |
| `/sohbet` | AI tasarım sohbeti; öneriler stüdyoyu doldurur, otomatik üretim yapmaz |
| `/fiyatlar` | Planlar ve demo PRO yükseltmesi (`/billing/dev-upgrade`, gerçek ödeme yok) |

## Kontroller

```bash
npm run lint
npx tsc --noEmit
npm run build
```
