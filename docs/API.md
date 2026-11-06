# Casalume — Sistem mimarisi ve API sözleşmesi (v1)

Bu belge tüm uygulamaların (backend, ai-service, web, admin, mobile) uyduğu tek sözleşmedir.
Değişiklik önce burada yapılır.

## 1. Bileşenler ve portlar

| Bileşen | Klasör | Teknoloji | Port (dev) | Kim çağırır |
|---|---|---|---|---|
| Backend API | `apps/backend` | NestJS + Prisma + PostgreSQL + Redis | 4000 | web (BFF), admin (BFF), mobile |
| AI servisi | `apps/ai-service` | Python FastAPI | 8001 | **yalnız backend** (iç ağ, `X-Internal-Token`) |
| Web | `apps/web` | Next.js (App Router) | 3000 | son kullanıcı (tarayıcı) |
| Admin | `apps/admin` | Next.js (App Router) | 3001 | yöneticiler |
| Mobil | `apps/mobile` | Expo SDK 58 (React Native) | 8081 (Metro/web) | son kullanıcı (iOS/Android) |

```
 Mobil (Bearer) ─────────────┐
 Web tarayıcı ─cookie─> Web BFF (Next.js route handlers) ──Bearer──┐
 Admin tarayıcı ─cookie─> Admin BFF (Next.js route handlers) ─Bearer┤
                                                                    ▼
                                         Backend (NestJS, /v1) ──X-Internal-Token──> AI servisi (FastAPI)
                                           │  PostgreSQL · Redis · görsel deposu        │ Gemini / Replicate / mock
                                           │                                            │ Claude (sohbet, analiz)
```

Güvenlik ilkeleri (red-team kataloğu kimlikleri):
- **SES-01 / WEB-03:** Web ve admin tarayıcıda token tutmaz. Token'lar Next.js sunucu tarafında
  `HttpOnly; Secure (prod); SameSite=Lax; Path=/` çerezlerinde durur. Durum değiştiren BFF uçları
  `Origin` başlığını kendi origin'iyle karşılaştırır (CSRF). Mobil, token'ı `expo-secure-store`'da tutar.
- **TOK-01 / TOK-02:** JWT yalnız HS256, `iss=casalume`, `aud` = `casalume-app` (kullanıcı) veya
  `casalume-admin` (yönetici), `typ=access`. Admin token'ı yalnız MFA tamamlanınca verilir (`amr: ["pwd","otp"]`).
- **AUT-01:** Admin girişi parola + TOTP (6 hane) ister. TOTP kayıtlı olmayan admin giriş yapamaz.
- **AZ-01 / AZ-02:** Her sorgu `userId` ile filtrelenir; başkasının kaydı 404 döner.
- **NET-02 / NET-04:** AI servisi dışarı açılmaz; `X-Internal-Token` olmadan 401.
- **FIL-01/02/04:** Yüklemeler backend'de imza + MIME kontrolüyle doğrulanır, yeniden JPEG'e kodlanır
  (EXIF/GPS silinir, KVKK), UUID ile saklanır; görseller yalnız süreli imzalı URL ile sunulur.
- **RES-01:** Cihaz/kullanıcı, IP ve global eşzamanlılık için ayrı kotalar (Redis).

## 2. Ortak kurallar (backend `/v1`)

- Taban URL: `http://localhost:4000/v1` (env: `API_BASE_URL`).
- Kimlik: `Authorization: Bearer <accessToken>`.
- JSON alan adları **camelCase**. Tarihler ISO-8601 string.
- Hata gövdesi her zaman:
  ```json
  { "error": { "code": "insufficient_credits", "message": "İnsan tarafından okunabilir mesaj" } }
  ```
  Kodlar: `bad_request` 400, `validation_failed` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404,
  `insufficient_credits` 402, `pro_required` 402 (PRO araç/stil), `invalid_token` 400 (e-posta bağlantısı geçersiz/kullanılmış/süresi dolmuş), `conflict` 409, `payload_too_large` 413, `unsupported_media_type` 415,
  `rate_limited` 429 (+ `Retry-After`), `ai_unavailable` 502, `busy` 503, `internal` 500.
- Sayfalama: `?cursor=<opaque>&limit=20` → `{ "items": [...], "nextCursor": "..." | null }`.
- `Accept-Language: tr|en` veya `?locale=tr|en` → katalog ve AI metinlerinin dili (varsayılan `tr`).

### Ortak tipler

```ts
type User = {
  id: string; email: string | null; emailVerified: boolean; name: string | null;
  role: 'USER' | 'ADMIN'; isGuest: boolean;
  plan: 'FREE' | 'PRO'; planExpiresAt: string | null;
  credits: number;            // satın alınan / admin tarafından verilen ek kredi
  dailyFreeRemaining: number; // bugünkü ücretsiz hak (FREE: 3/gün, PRO: 100/gün adil kullanım)
  locale: 'tr' | 'en'; createdAt: string;
};
type AuthResponse = { accessToken: string; refreshToken: string; expiresIn: number; user: User };
type ImageRef = { id: string; url: string; width: number; height: number }; // url: imzalı, 24 saat geçerli, mutlak
type ToolId = 'redesign' | 'furnish' | 'declutter' | 'replace' | 'paint' | 'flooring'
            | 'exterior' | 'garden' | 'reference' | 'custom';
type Design = {
  id: string; title: string; tool: ToolId;
  styleId: string | null; roomId: string | null;
  params: Record<string, unknown>;          // floorId, colorHex, target, replacement, instructions, removeAll
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED'; error: string | null;
  input: ImageRef; results: ImageRef[];
  favorite: boolean; featured: boolean; createdAt: string;
};
type Analysis = {
  id: string; designId: string; imageId: string;
  summary: string; palette: string[];       // hex
  items: { name: string; category: string; material: string; color: string; quantity: number;
           priceMinTRY: number; priceMaxTRY: number; links: { store: string; url: string }[] }[];
  renovation: { task: string; unit: string; quantity: number; costMinTRY: number; costMaxTRY: number }[];
  totals: { furnitureMinTRY: number; furnitureMaxTRY: number; renovationMinTRY: number;
            renovationMaxTRY: number; grandMinTRY: number; grandMaxTRY: number };
  disclaimer: string; createdAt: string;
};
```

Kredi kuralı: her varyant 1 hak. Önce `dailyFreeRemaining`, sonra `credits` düşer. Başarısız üretim iade edilir.

## 3. Kullanıcı uçları

| Metot | Yol | Gövde | Yanıt |
|---|---|---|---|
| POST | `/auth/guest` | `{ deviceId }` (16–64, `[A-Za-z0-9-]`) | `AuthResponse` (aynı cihaz → aynı misafir) |
| POST | `/auth/register` | `{ email, password (≥10), name? }` — geçerli misafir Bearer varsa o hesap yükseltilir | `AuthResponse` |
| POST | `/auth/login` | `{ email, password }` | `AuthResponse` (admin rolü burada da USER kapsamında token alır) |
| POST | `/auth/refresh` | `{ refreshToken }` (rotasyon; yeniden kullanım → aile iptali, SES-05) | `AuthResponse` |
| POST | `/auth/logout` | `{ refreshToken }` | 204 |
| POST | `/auth/password/forgot` | `{ email }` | 202 `{ ok: true }` — hesap olsun olmasın aynı yanıt; mail arka planda (AUT-03) |
| POST | `/auth/password/reset` | `{ token, password (≥10) }` | 204 — tüm oturumlar ve bekleyen e-posta token'ları iptal (SES-04) |
| POST | `/auth/email/verify` | `{ token }` | `{ ok: true }` |
| POST | `/auth/email/resend` | — (Bearer, kayıtlı kullanıcı) | 202 `{ ok: true, alreadyVerified }` |
| GET | `/me` | — | `User` |
| PATCH | `/me` | `{ name?, locale? }` | `User` |
| DELETE | `/me` | — | 204 (KVKK: hesap, tasarım ve görseller silinir) |
| GET | `/catalog` | — | `Catalog` (aşağıda) |
| POST | `/uploads` | `{ data: base64, mimeType: 'image/jpeg'|'image/png'|'image/webp'|'image/heic' }` (≤10 MB) | `{ image: ImageRef }` |
| POST | `/uploads/sample` | `{ sample: 'living_room'|'empty_room'|'bedroom'|'exterior'|'garden' }` | `{ image: ImageRef }` |
| POST | `/designs` | `CreateDesign` (aşağıda) | `Design` (senkron; 5–60 sn sürebilir) |
| GET | `/designs` | `?cursor&limit&favorite=true` | `{ items: Design[], nextCursor }` |
| GET | `/designs/:id` | — | `Design` |
| PATCH | `/designs/:id` | `{ favorite: boolean }` | `Design` |
| DELETE | `/designs/:id` | — | 204 |
| POST | `/designs/:id/analysis` | `{ imageId?: string }` (varsayılan ilk sonuç) | `Analysis` (aynı görsel için önbellekli) |
| POST | `/chat` | `{ messages: { role: 'user'|'assistant'; text: string (≤2000); imageId?: string }[] (≤20) }` | `{ reply: string, suggestions: Suggestion[] }` |
| GET | `/inspiration` | — | `{ items: { id, title, styleId, roomId, imageUrl, palette: string[] }[] }` |
| POST | `/billing/dev-upgrade` | — (yalnız NODE_ENV≠production) | `User` (7 gün PRO) |
| GET | `/images/:id?exp=&sig=` | — | `image/jpeg` |
| GET | `/health` | — | `{ status: 'ok'|'degraded', db, redis, ai }` |
| GET | `/styles/:id/preview.jpg` | — | `image/jpeg` (stil paletli örnek oda önizlemesi) |

```ts
type CreateDesign = {
  tool: ToolId; inputImageId: string; variants?: 1 | 2 | 3 | 4;  // varsayılan 2
  styleId?: string; roomId?: string; floorId?: string;
  colorHex?: string; colorName?: string;                       // paint
  target?: string; replacement?: string;                       // declutter / replace (≤120)
  instructions?: string;                                       // ≤300, custom/ek istek
  removeAll?: boolean;                                         // declutter: odayı tamamen boşalt
  referenceImageId?: string;                                   // reference
};
type Catalog = {
  tools: { id: ToolId; name: string; description: string; icon: string /* Ionicons adı */;
           category: 'interior' | 'exterior' | 'edit'; isPro: boolean; isNew: boolean;
           needs: { style: boolean; room: boolean; floor: boolean; color: boolean; target: boolean;
                    replacement: boolean; instructions: boolean; reference: boolean; removeAll: boolean } }[];
  styles: { id: string; name: string; description: string; palette: string[]; isPro: boolean;
            previewUrl: string /* GET /v1/styles/:id/preview.jpg — herkese açık, kullanıcı verisi içermez */ }[];
  rooms: { id: string; name: string; icon: string }[];
  floors: { id: string; name: string }[];
  colors: { id: string; name: string; hex: string }[];
  plans: { id: string; name: string; period: 'week' | 'month' | 'year'; priceTRY: number; badge: string | null }[];
};
type Suggestion = { label: string; tool: ToolId; styleId?: string; roomId?: string; instructions?: string };
```

E-posta bağlantıları (MAIL-01): yalnız `WEB_APP_URL` + sabit yol + fragment ile üretilir —
`{WEB_APP_URL}/sifre-sifirla#token=…` (30 dk) ve `{WEB_APP_URL}/eposta-dogrula#token=…` (48 sa). Token 43 karakter
base64url, tek kullanımlık; sunucuda yalnız SHA-256'sı tutulur. Geliştirmede postalar `apps/backend/data/outbox/`
klasörüne yazılır, üretimde SMTP zorunludur.

Sohbet önerileri yalnız öneridir; istemci kullanıcı dokunmadan üretim başlatmaz (AI-01).

## 4. Admin uçları (`aud=casalume-admin`, rol ADMIN, MFA tamam)

| Metot | Yol | Gövde | Yanıt |
|---|---|---|---|
| POST | `/admin/auth/login` | `{ email, password, otp }` | `{ accessToken, expiresIn, admin: User }` (2 saat, refresh yok) |
| GET | `/admin/stats` | `?days=30` | `AdminStats` |
| GET | `/admin/users` | `?q&cursor&limit` | `{ items: AdminUser[], nextCursor }` |
| GET | `/admin/users/:id` | — | `AdminUser & { recentDesigns: Design[]; ledger: LedgerEntry[] }` |
| PATCH | `/admin/users/:id` | `{ status?: 'ACTIVE'|'BANNED'; plan?: 'FREE'|'PRO'; planExpiresAt?: string|null }` | `AdminUser` |
| POST | `/admin/users/:id/credits` | `{ delta: int (−1000..1000, ≠0), reason: string (3..200) }` | `AdminUser` |
| GET | `/admin/designs` | `?status&tool&styleId&userId&cursor&limit` | `{ items: (Design & { userId; userEmail: string|null })[], nextCursor }` |
| PATCH | `/admin/designs/:id` | `{ featured: boolean }` | `Design` |
| DELETE | `/admin/designs/:id` | — | 204 |
| GET | `/admin/styles` | — | `AdminStyle[]` |
| POST | `/admin/styles` | `AdminStyleInput` (id dahil) | `AdminStyle` |
| PATCH | `/admin/styles/:id` | `Partial<AdminStyleInput>` | `AdminStyle` |
| GET | `/admin/audit` | `?cursor&limit` | `{ items: AuditEntry[], nextCursor }` |
| GET | `/admin/system` | — | `{ ai: { status: 'ok'|'down'; provider: string; chatEnabled: boolean; latencyMs: number|null }; db: 'ok'|'down'; redis: 'ok'|'down'; version: string }` |

```ts
type AdminUser = User & { status: 'ACTIVE' | 'BANNED'; designsCount: number; lastSeenAt: string | null };
type LedgerEntry = { id: string; delta: number; reason: string; refId: string | null; createdAt: string };
type AdminStats = {
  totals: { users: number; guests: number; registered: number; pro: number; designs: number;
            designsToday: number; failedToday: number; creditsSpentToday: number; analyses: number };
  daily: { date: string /* YYYY-MM-DD */; designs: number; failed: number; newUsers: number }[];
  byTool: { tool: ToolId; count: number }[];
  byStyle: { styleId: string; count: number }[];
};
type AdminStyleInput = { id: string /* [a-z_]{2,40} */; nameTr: string; nameEn: string;
  descriptionTr: string; descriptionEn: string; prompt: string; palette: string[];
  isPro: boolean; isActive: boolean; sortOrder: number };
type AdminStyle = AdminStyleInput & { usageCount: number };
type AuditEntry = { id: string; actorEmail: string | null; action: string; targetType: string;
  targetId: string | null; meta: Record<string, unknown>; createdAt: string };
```

## 5. AI servisi (iç API, `http://localhost:8001`, başlık `X-Internal-Token`)

Alan adları **snake_case**. Görseller base64 JPEG.

| Metot | Yol | Gövde | Yanıt |
|---|---|---|---|
| POST | `/internal/v1/generate` | `{ tool, image_b64, variants, style_prompt?, room?, floor?, color_hex?, color_name?, target?, replacement?, instructions?, remove_all?, reference_image_b64? }` | `{ images_b64: string[], prompt: string, provider: string, reference_style: string|null }` |
| POST | `/internal/v1/analyze` | `{ image_b64, locale, room?, style_name? }` | `{ summary, palette, items: [{ name, category, material, color, quantity, price_min_try, price_max_try, search_query }], renovation: [{ task, unit, quantity, cost_min_try, cost_max_try }], disclaimer }` |
| POST | `/internal/v1/chat` | `{ locale, messages: [{ role, text, image_b64? }], catalog: { tools: [{id,name}], styles: [{id,name}], rooms: [{id,name}] } }` | `{ reply, suggestions: [{ label, tool, style_id?, room_id?, instructions? }] }` |
| GET | `/internal/v1/health` | — | `{ status: 'ok', provider, chat_enabled }` |

Sağlayıcılar: `IMAGE_PROVIDER=mock|gemini|replicate`. Claude anahtarı yoksa sohbet ve analiz deterministik
demo yanıtı döner (uygulama anahtarsız uçtan uca çalışır).

## 6. Tasarım dili (tüm istemciler)

| Token | Açık | Koyu |
|---|---|---|
| `primary` (zümrüt) | `#1F6F5C` | `#3FB28F` |
| `accent` (terrakota) | `#E07A4F` | `#F09A72` |
| `bg` | `#F7F4EF` | `#0E1311` |
| `surface` | `#FFFFFF` | `#18201D` |
| `text` | `#141414` | `#F2EFEA` |
| `muted` | `#6B6A66` | `#A3A8A4` |
| `border` | `#E6E1D8` | `#2A332F` |

Köşe yarıçapı 14–20, yumuşak gölge, Türkçe öncelikli metinler, ikonlar Ionicons/Lucide.
Marka: **Casalume** — "Odanı saniyeler içinde yeniden tasarla".

## 7. v1.1 eklemeleri (backend + AI servisi)

### 7.1 Asenkron üretim ve kredi rezervasyonu
- `POST /designs` iki modda çalışır. Varsayılan **senkron** davranış değişmedi.
  - `Prefer: respond-async` başlığıyla çağrılırsa **202** + `Design` (`status: 'PENDING'`) döner. İş BullMQ
    kuyruğunda çalışır; istemci `GET /designs/:id` ile durumu sorgular (önerilen aralık 2 sn).
  - İsteğe bağlı `Idempotency-Key` başlığı: `[A-Za-z0-9_-]{8,64}`, kullanıcı başına 24 saat. Aynı anahtarla tekrar
    gelen istek yeni üretim başlatmaz, aynı `Design`'ı döndürür (200).
- Kredi akışı: önce rezerve edilir (`HELD`), başarıda kesinleşir (`CAPTURED`), hata, zaman aşımı veya "değişiklik
  yok" durumunda iade edilir (`RELEASED`). Durum geçişleri atomiktir; çift iade olmaz.
- Takılan işler: 10 dakikadan uzun `PENDING` kalan tasarım uzlaştırma işiyle `FAILED` (`timeout`) yapılır, kredisi iade edilir.
- `Design` alanlarına `queuedAt`, `startedAt` ve `chargeState` ('HELD'|'CAPTURED'|'RELEASED') eklenir.
- Yeni hata kodu: `generation_paused` 503. Bütçe kesicisi FREE kullanıcının üretimini durdurduğunda döner.

### 7.2 AI maliyet defteri, bütçe kesici, çalışma zamanı ayarları
- AI servisi her yanıtta `usage` döndürür. Backend bunu `AiUsage` tablosuna yazar.
  `usage: { provider, model, kind: 'generate'|'analyze'|'chat'|'describe', images, input_tokens, output_tokens, latency_ms, cost_usd, fallback_used }`
- Bütçe durumu: `normal` (< %80), `warning` (%80–100), `exceeded` (≥ %100, `dailyBudgetUsd` aşıldı).
  `exceeded` olduğunda `budgetBrakeMode` ayarı uygulanır:
  - `off`: hiçbir şey değişmez.
  - `free_single_variant`: FREE kullanıcı en fazla 1 varyant üretir.
  - `free_paused`: FREE kullanıcıya 503 `generation_paused` döner.
- Ayarlar `Setting` tablosunda tutulur; tipli varsayılanları kodda durur. Admin uçları (gerekçe zorunlu, denetlenir):
  | Metot | Yol | Gövde | Yanıt |
  |---|---|---|---|
  | GET | `/admin/settings` | — | `{ values: Settings, defaults: Settings }` |
  | PATCH | `/admin/settings` | `{ values: Partial<Settings>, reason: string (3..200) }` | `{ values: Settings }` |
  | GET | `/admin/ai/usage` | `?days=30` | `{ today: { costUsd, calls, images }, budget: { dailyBudgetUsd, spentTodayUsd, state, brakeMode }, daily: { date, costUsd, calls }[], byProvider: { provider, model, calls, costUsd }[], byKind: { kind, calls, costUsd }[] }` |
  ```ts
  type Settings = {
    freeDailyGenerations: number; proDailyGenerations: number;   // 0..1000
    maxVariantsFree: 1|2|3|4; maxVariantsPro: 1|2|3|4;
    dailyBudgetUsd: number;                                      // 0 = sınırsız
    budgetBrakeMode: 'off' | 'free_single_variant' | 'free_paused';
    maintenance: { enabled: boolean; messageTr: string; messageEn: string };   // açıkken üretim 503 `busy`
    announcement: { enabled: boolean; textTr: string; textEn: string } ;
    requireAiConsent: boolean;  // true ise üretimden önce güncel `ai_processing` onayı aranır (403 `consent_required`)
  };
  ```
- `GET /catalog` yanıtına şu alanlar eklenir:
  - `announcement: string | null`
  - `maintenance: { enabled: boolean; message: string }`
  - `legal: { termsVersion: string; privacyVersion: string; aiProcessingVersion: string }`

### 7.3 KVKK ve içerik bildirimi
| Metot | Yol | Gövde | Yanıt |
|---|---|---|---|
| GET | `/me/export` | — | Kullanıcının tüm verisi: profil, onaylar, tasarımlar (imzalı URL'lerle), analizler, kredi hareketleri, bildirimler. KVKK m.11; saatte 3 istek sınırı. |
| GET | `/me/consents` | — | `{ items: { kind, version, granted, createdAt }[], current: { terms, privacy, ai_processing, marketing } }` |
| POST | `/me/consents` | `{ kind: 'terms'|'privacy'|'ai_processing'|'marketing', version: string, granted: boolean }` | 201 `{ kind, version, granted, createdAt }`. Kayıtlar eklenerek tutulur, silinmez. |
| POST | `/designs/:id/report` | `{ reason: 'inappropriate'|'offensive'|'copyright'|'privacy'|'other', note?: string (≤500) }` | 201 `{ id, status: 'OPEN' }`. Kendi tasarımı ya da öne çıkarılmış bir tasarım bildirilebilir; Google Play üretken AI politikası gereği. |
| GET | `/admin/reports` | `?status=OPEN|RESOLVED|DISMISSED&cursor&limit` | `{ items: { id, designId, reason, note, status, reporterId, createdAt, resolvedAt, resolution, design: Design }[], nextCursor }` |
| PATCH | `/admin/reports/:id` | `{ status: 'RESOLVED'|'DISMISSED', resolution: string (3..500), unfeature?: boolean, deleteDesign?: boolean }` | Güncel kayıt (denetlenir) |
| GET | `/admin/jobs` | `?limit=50` | Zamanlı işlerin son çalışmaları: `{ items: { id, name, status: 'ok'|'error', startedAt, finishedAt, details }[], queue: { waiting, active, failed, delayed } }` |

Zamanlı işler BullMQ ile tekrarlı çalışır; her çalışma `JobRun` tablosuna yazılır:
- `reconcile-designs` (her dakika): takılan işleri `FAILED` yapar ve kredisini iade eder.
- `retention` (günlük 03:30 TR): 7 günü geçen bağlantısız yükleme ve örnek görselleri, süresi dolmuş token'ları ve
  outbox postalarını siler.

### 7.4 AI servisi (§5'e ek)
- `usage` alanı `generate`, `analyze` ve `chat` yanıtlarında döner (biçimi §7.2'de).
- Yedek sağlayıcı zinciri: `IMAGE_PROVIDER` birincil sağlayıcıdır, `IMAGE_FALLBACKS=replicate,...` sırayla denenir.
  Yalnız yeniden denenebilir hatada (`retryable`) ya da devre açıkken sıradakine geçilir.
- Devre kesici: süreç içinde, sağlayıcı başına çalışır. 5 ardışık hatada 60 sn açılır, ardından tek deneme isteğiyle kontrol edilir (yarı açık).
- Süre bütçesi: bir `generate` isteği toplam 150 sn'yi aşamaz.
- `POST /internal/v1/quality` `{ image_b64 }` → `{ score: 0..100, issues: ('too_dark'|'too_bright'|'blurry'|'low_res'|'low_contrast')[], metrics }`.
  Backend bunu `/uploads` sırasında çağırır ve `quality` alanını uyarı olarak yanıta ekler: `{ image, quality }`.
- "Değişiklik yok" tespiti: çıktı girdiye çok benziyorsa (küçültülmüş görüntülerin ortalama mutlak farkı 3'ün altındaysa)
  o varyant atılır. Hiç geçerli varyant kalmazsa 422 `no_change` döner; backend krediyi iade eder.
- Hata gövdesine `retryable: boolean` eklenir. Backend kuyruğu yalnız yeniden denenebilir hatada işi tekrarlar.
- Kısmi sonuç: varyantlardan bazıları atılırsa `images_b64` istenenden az görsel içerir. Backend eksik varyantların
  kredisini iade eder; önce ücretli kredi, sonra günlük hak iade edilir.
- 422 `no_change` gövdesinde üst seviye `usage` da döner. Backend maliyeti kaydeder ve krediyi iade eder.

### 7.5 API dokümantasyonu (Swagger / OpenAPI)
- Backend: Swagger UI `GET /docs`, şema `GET /docs/openapi.json`. Yalnız `SWAGGER_ENABLED=true` iken açılır;
  varsayılan geliştirmede açık, üretimde kapalı. Yoga test raporundaki "Swagger herkese açık" bulgusu böylece önlenir.
  Statik kopyası `docs/openapi/backend.json` dosyasındadır.
- AI servisi: FastAPI `GET /docs` ve `GET /openapi.json` yalnız `ENV != production` iken açılır. Statik kopyası
  `docs/openapi/ai-service.json` dosyasındadır.

### 7.6 Mağaza aboneliği (RevenueCat) — #2
| Metot | Yol | Gövde | Yanıt |
|---|---|---|---|
| POST | `/webhooks/revenuecat` | RevenueCat olay gövdesi `{ api_version, event }` | 200 `{ ok, result: 'queued'|'duplicate' }`. 401 imza/yetki hatası, 404 yapılandırılmamış. |
| POST | `/billing/sync` | — (Bearer) | `User`. Satın alma veya geri yükleme sonrası RevenueCat REST ile durum eşitlenir. |
| GET | `/admin/billing/events` | `?status=queued|processed|unmatched|ignored|failed&cursor&limit` | Webhook kutusu |
| POST | `/admin/billing/events/:id/retry` | — | `{ id, status }` (denetlenir) |

- **Kimlik doğrulama, yazmadan önce yapılır (yoga BE-01 dersi):**
  - `Authorization` başlığı panelde ayarlanan değerle birebir aynı olmalıdır (`REVENUECAT_WEBHOOK_AUTH`).
  - HMAC: `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex>` başlığıyla gelir; imzalanan metin `"<t>.<ham gövde>"`, algoritma
    HMAC-SHA256 (`REVENUECAT_WEBHOOK_SECRET`).
  - Zaman damgası ±5 dk içinde olmalıdır; karşılaştırmalar sabit zamanlıdır.
  - Hiçbiri yapılandırılmamışsa uç kapalıdır (404). Üretimde HMAC sırrı zorunludur.
- **Tek seferlik işleme:**
  - `event.id` birincil anahtardır; RevenueCat tekrar denediğinde de aynı `id` gelir ve yeniden işlenmez.
  - Olay kuyrukta işlenir. `REVENUECAT_API_KEY` varsa `GET /v1/subscribers/{app_user_id}` ile abone kaydının tamamı eşitlenir,
    yoksa olay alanlarından türetilir.
- **Eşleme:** `app_user_id` bizim kullanıcı UUID'imizdir; mobil uygulama RevenueCat'i bu kimlikle yapılandırır. Eşleşmeyen olaylar
  admin'de "Eşleşmeyen" olarak görünür ve yeniden işlenebilir.
- **PRO kaynakları:** `User.plan` (admin / demo verilen PRO) ile `User.storeProUntil` (mağaza aboneliği) birbirinden ayrıdır.
  Kullanıcı ikisinden biri geçerliyse PRO'dur. Abonelik durumları: `active`, `grace`, `cancelled`, `billing_issue`, `expired`.
- **Kredi paketleri:** `CREDIT_PACKS=productId:kredi,...` ile tanımlanır. Mağaza işlem kimliği `StorePurchase` tablosunun
  birincil anahtarıdır; aynı satın alma iki kez krediye çevrilmez.
- **Katalog:** `plans[].storeProductId` ve `creditPacks[]` alanları eklendi.

### 7.7 Görsel deposu (S3 / R2) — #3
- `STORAGE_DRIVER=local|s3`. `s3` sürücüsü S3 uyumlu her kovayla çalışır: Cloudflare R2, AWS S3, MinIO.
  Ayarlar: `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PREFIX`.
- Kova **özel** kalır; istemcilere yine backend'in 24 saatlik imzalı URL'si verilir (FIL-04) ve backend nesneyi akıtır.
  İstemci sözleşmesi ve CSP değişmez.
- Anahtarlar yalnız sunucunun ürettiği UUID'lerdir (`images/<uuid>.jpg`); kullanıcı girdisi anahtar olamaz.
- Taşıma: `npm run storage:migrate` yerel dosyaları kovaya kopyalar; tekrar çalıştırmak güvenlidir.
  Yerelde varsayılan `local` sürücüdür; S3/R2 yolu staging'de denenir (s3rver güvenlik açığı nedeniyle kaldırıldı, #10).
- `/health` ve `/admin/system` yanıtlarına depolama sürücüsü ve durumu (`storage`) eklendi.

### 7.8 Bölge kilidi ve fal.ai (maske tabanlı düzenleme) — #4
Rakiplerde en sık şikâyet: "boyamak istedim, pencerelerimi de değiştirdi". Yerel düzenlemelerde değişiklik maskeyle sınırlanır.
- Hedef bölge araca göre belirlenir: `paint` → `wall`, `flooring` → `floor`, `replace` → `target` (yoksa `sofa`),
  `declutter` → `target` (yalnız hedefli silmede; `remove_all` ve hedefsiz silme tüm sahneyi düzenler).
  Diğer araçlarda (`redesign`, `furnish`, `exterior`, `garden`, `reference`, `custom`) bölge kilidi yoktur.
- Maske, görsel üretimiyle **aynı anda** fal.ai SAM 3 ile çıkarılır (`FALAI_SEG_MODEL=fal-ai/sam-3/image`, metin istemli).
  Puanı 0,5'in altındaki maskeler atılır, kalanların birleşimi kullanılır. Bu yüzden kilit ek gecikme getirmez.
- Hangi sağlayıcı üretirse üretsin (Gemini, Replicate, fal), çıktı yalnız maske içinde orijinalle birleştirilir
  (3 px yumuşak kenar). Maske dışında kullanıcının kendi pikselleri kalır; fark yalnız JPEG yeniden kodlama gürültüsüdür.
- "Değişiklik yok" tespiti kilitli düzenlemede yalnız maske içinde ölçülür. Böylece küçük ama gerçek bir düzenleme atılmaz.
- Maske çıkarılamazsa (hata, zaman aşımı) ya da kapsamı %0,5'ten az veya %95'ten fazlaysa tasarım **başarısız olmaz**.
  Düzenleme kilitsiz sürer ve yanıtta nedeni yazar.
- Yanıt: `region: { applied, target, method: 'sam3'|'heuristic'|'none', coverage: 0..1, reason: null|'no_segmenter'|'segmentation_failed'|'mask_unusable' } | null`.
  Backend bunu `Design.params.region` içinde saklar ve tasarım DTO'sunda `region` olarak döndürür.
- Maliyet: SAM 3 çağrısı (`FALAI_SEG_COST_USD`, varsayılan 0,005 $) aynı `generate` kaydına eklenir.
- `FAL_KEY` yoksa: `mock` sağlayıcıda açıkça etiketli geometrik maske (`method: 'heuristic'`) kullanılır, yalnız demo içindir.
  Gerçek sağlayıcılarda sahte maske kullanılmaz; kilit uygulanmaz (`reason: 'no_segmenter'`). `REGION_LOCK=off` kilidi kapatır.
- Yeni görsel sağlayıcısı `falai`: FLUX.2 [klein] 4B edit (`FALAI_EDIT_MODEL`, görsel başına ~0,012 $).
  `IMAGE_PROVIDER` veya `IMAGE_FALLBACKS` içinde kullanılabilir.
  - Girdi ve çıktı `sync_mode` ile satır içi data URI olarak taşınır. URL dönerse yalnız `https` + `fal.media`/`fal.run`/`fal.ai`
    alan adlarından indirilir (EXT-01, SSRF).
  - Güvenlik denetimi açıktır; `has_nsfw_concepts` yeniden denenmeyen `falai_safety_blocked` hatasına dönüşür.

### 7.9 "Tasarımın hazır" push bildirimi — #5
- Yalnız **kuyruktaki** tasarımlar bildirim gönderir (`Prefer: respond-async`). Senkron istekte kullanıcı zaten ekranda bekler.
  Mobil uygulama artık her tasarımı asenkron başlatır, `Idempotency-Key` ile gönderir ve tasarım ekranında `PENDING` durumunu yoklar
  (1,5 sn'den başlayıp 5 sn'ye kadar uzayan aralıkla). Kullanıcı uygulamadan çıkarsa bildirim gelir.
- `POST /v1/me/push-tokens { token, platform: 'ios'|'android' }` → 204. Yalnız Expo push token kabul edilir
  (`ExponentPushToken[...]`/`ExpoPushToken[...]`), aksi 400. Kayıt token'a göre upsert edilir; aynı cihaz başka hesapla
  kaydolursa token o hesaba **taşınır** ve eski hesap o cihaza bildirim gönderemez (AZ-01). Kullanıcı başına en çok 10 cihaz tutulur.
  Hız sınırı: saatte 30.
- `DELETE /v1/me/push-tokens { token }` → 204 (çıkışta ve bildirim kapatılınca). Başka hesabın token'ı sessizce yok sayılır.
- Gönderim: tasarım işi bitince (başarılı ya da son denemede başarısız) `notifications` kuyruğuna `design-result` işi eklenir.
  İş kimliği `design-<id>` olduğu için tasarım işi yeniden çalışsa da tek bildirim gider. Bildirim sorunu tasarımı asla başarısız yapmaz.
- İçerik kullanıcının diline göre (TR/EN):
  - Başarılı: "Tasarımın hazır" + `"<başlık>" tamamlandı`.
  - Başarısız: "Tasarım oluşturulamadı" + "Hakkın iade edildi".
  - `data: { type: 'design', designId, status, url: 'casalume://design/<id>' }`. Uygulama yalnız UUID biçimindeki `designId`'yi kullanır,
    yükteki URL'ye gitmez.
- Taşıma: `PUSH_TRANSPORT=outbox` (geliştirme: `DATA_DIR/push-outbox/*.json`) | `expo` (Expo Push API, üretimde zorunlu).
  `EXPO_ACCESS_TOKEN`, Expo projesinde "enhanced push security" açıksa gerekir.
- Ölü cihaz temizliği: Expo bileti ya da 15 dk sonra kontrol edilen makbuz `DeviceNotRegistered` derse token silinir.
  270 gündür görülmeyen cihazlar gece bakım işinde silinir. 429/5xx yanıtlarında iş üstel geri çekilmeyle yeniden denenir.
- KVKK: token'lar loglanmaz, loglarda yalnız maskeli hâli görünür (LOG-02). `GET /me/export` yanıtında `pushDevices` alanı
  maskeli token, platform ve tarihleri içerir. Hesap silinince token'lar da silinir.
- `/admin/system` yanıtı `push: { transport, devices }`, `/admin/jobs` yanıtı `notifications` kuyruk sayılarını içerir.
- Mobil: izin ilk açılışta değil, kullanıcı ilk tasarımını başlatınca istenir. İzin verilmişse her açılışta ve her hesap değişiminde
  token sessizce yeniden kaydedilir. Push için EAS `projectId` ve development build gerekir; Expo Go Android'de push almaz.

### 7.10 Örnek fotoğraflar
- `POST /v1/uploads/sample` artık çizim değil **gerçek oda fotoğrafı** döndürür: salon, boş oda, yatak odası, dış cephe, bahçe.
  Fotoğraflar Pexels lisanslıdır; kaynak ve fotoğrafçılar `apps/backend/assets/samples/CREDITS.md` dosyasındadır.
- Fotoğraflar 1280×960'a kırpılmış ve meta verisi silinmiştir; salon fotoğrafında görünen araç plakası bulanıklaştırılmıştır.
  Dosyalar backend ile birlikte gelir, çalışma sırasında indirilmez.

### 7.11 Admin rolleri ve MFA kurtarma — #6 (backend)
Roller hiyerarşiktir: `SUPPORT < EDITOR < ADMIN < SUPER_ADMIN`. Her admin ucu en düşük rolünü açıkça bildirir (`@MinRole`).
Rol bildirmeyen uç **reddedilir** (AZ-01). Rol her istekte veritabanından okunur; düşürme ya da MFA sıfırlama bir sonraki istekte etkili olur.

**Panelden kodsuz giriş** (sahibinin kararı, RUNBOOK §4):
- `ADMIN_PANEL_KEY` tanımlıysa, `x-admin-panel-key` başlığı bu anahtarla birebir eşleşen `POST /admin/auth/login`
  isteği kodsuz kabul edilir. Karşılaştırma sabit sürelidir.
- Bu başlığı yalnız admin panelinin sunucu tarafı gönderir. Token `amr: ["pwd","panel"]` taşır ve anahtar
  kaldırılınca geçersiz olur.
- Başlıksız ya da yanlış anahtarlı istekte kod zorunludur. Adım yükseltme gerektiren işlemler (yedek kod yenileme)
  yine TOTP ister.

| Rol | Yetki |
|---|---|
| SUPPORT | İstatistik, kullanıcı/tasarım/stil/ayar okuma, ödeme olaylarını görme, içerik bildirimlerini sonuçlandırma |
| EDITOR | + stil ekleme/düzenleme, tasarım öne çıkarma, bildirimde "öne çıkarmayı kaldır" |
| ADMIN | + kullanıcı durum/plan/kredi, ayarları değiştirme, tasarım silme, AI maliyeti, denetim kaydı, işler/sistem, ödeme olayını yeniden deneme |
| SUPER_ADMIN | + yönetici ekibi: rol verme/kaldırma, MFA sıfırlama; yönetici hesaplarında plan/kredi |

- Yönetici hesapları yalnız `/admin/admins` üzerinden değişir. `PATCH /admin/users/:id` bir yöneticiyi askıya alamaz
  ("önce rolünü kaldırın"). Plan/kredi değişikliği SUPER_ADMIN ister.
- `GET /admin/admins` (SUPER_ADMIN): ekip, rol, MFA durumu, kalan yedek kod, son görülme.
- `PATCH /admin/admins/:id { role: USER|SUPPORT|EDITOR|ADMIN|SUPER_ADMIN, reason }` (SUPER_ADMIN):
  - Kendi rolünü değiştirmek 400 döner. Hedef e-postası doğrulanmış, aktif, kayıtlı bir hesap olmalıdır (misafir olamaz).
  - Son SUPER_ADMIN düşürülemez (409). Kontrol **serializable** işlemde yapılır; iki SUPER_ADMIN aynı anda birbirini
    düşürürse yalnız biri başarılı olur, diğeri 409 alır (eşzamanlılık testiyle doğrulandı).
  - Rol değişince hedefin bütün oturumları kapanır (`tokenVersion`). USER'a düşen hesabın TOTP sırrı ve yedek kodları silinir.
    TOTP'si olmayan yeni yönetici için 72 saatlik kayıt penceresi açılır (`mfaEnrollBefore`).
- `POST /admin/admins/:id/mfa-reset { reason }` (SUPER_ADMIN, kendine uygulanamaz): TOTP + yedek kodlar silinir,
  oturumlar kapanır ve 72 saatlik yeniden kayıt penceresi açılır.
- Her rol ve MFA değişikliği denetim kaydına yazılır (`admin.role_change`, `admin.mfa_reset`, `admin.mfa_enrolled`,
  `admin.backup_codes_regenerated`, `admin.login` + `factor`). Etkilenen yöneticiye e-posta gider (AUT-04: sessiz arka kapı yok).
  E-postadaki bağlantı `ADMIN_APP_URL` adresidir (üretimde https zorunlu).

**Giriş ve kayıt** (AUT-01: her giriş yolu MFA'yı tamamlamadan oturum vermez)
- `POST /admin/auth/login { email, password, otp }` **veya** `{ email, password, backupCode }`; ikisi birlikte gönderilemez.
  - Yedek kod yalnız parola doğruysa harcanır. Tek kullanımlıktır (atomik `usedAt`), büyük/küçük harf ve tire önemsizdir.
  - Yanıtta `backupCodesRemaining` döner ve yöneticiye "yedek kodla giriş yapıldı" e-postası gider.
  - Token `amr` değeri: TOTP ile `otp`, yedek kodla `mfa`.
- Doğrulayıcısı olmayan, kayıt penceresi açık yönetici doğru parolayla 403 `mfa_enrollment_required` alır.
  - `POST /admin/auth/mfa/enroll { email, password }` → `{ secret, otpauth }`.
  - `POST /admin/auth/mfa/confirm { email, password, otp }` → oturum + **10 yedek kod**. Kodlar yalnız bu yanıtta gösterilir.
  - Pencere dolarsa SUPER_ADMIN'in MFA sıfırlaması gerekir. Hız sınırı: IP başına saatte 10.
- `GET /admin/me` (her rol): rol + `mfa { enrolled, backupCodesRemaining }`.
- `POST /admin/me/backup-codes { otp }`: yeni 10 kod üretir, eskileri geçersiz olur. **Güncel ve kullanılmamış** bir TOTP kodu ister
  (yeniden doğrulama); açık oturum tek başına yetmez.
- Yedek kod biçimi `XXXXX-XXXXX`: 0/O/1/I/L/U yok, ~49 bit. Veritabanında yalnız `HMAC-SHA256(DEVICE_PEPPER, kod)` tutulur;
  veritabanının bir kopyası tek başına çevrimdışı denemeye yetmez.
- Geçiş: önceki `ADMIN` hesapları migrasyonla `SUPER_ADMIN` oldu; o zamana kadar her şeyi yapabiliyorlardı. Seed ilk hesabı
  SUPER_ADMIN olarak ve 10 yedek kodla oluşturur. Kodlar `DATA_DIR/admin-credentials.txt` dosyasına yazılır (git'e girmez, izin 600).
- Admin paneli ekranları (ekip yönetimi, yedek kod gösterimi, role göre menü) henüz yapılmadı; admin aşamasında tek tek ele alınacak.
  Şimdilik panelde yalnız girişin her admin rolünü kabul etmesi uyumlu hâle getirildi.


### 7.12 Apple / Google ile giriş — #7 (backend)
Mobil uygulama yerel SDK'dan (Sign in with Apple, Google Sign-In) bir **ID token** alır ve onu backend'e gönderir. Şifre ya da
sağlayıcı erişim token'ı backend'e gelmez.

**Akış**
1. `POST /auth/oauth/nonce` → `{ nonce, expiresIn: 600 }`. Tek kullanımlıktır, Redis'te yalnız SHA-256'sı tutulur (TOK-03).
   Uygulama sağlayıcı SDK'sına `SHA-256(nonce)` (hex) verir. Hız sınırı: IP başına saatte 60.
2. `POST /auth/oauth/google { idToken, nonce }` ya da `POST /auth/oauth/apple { identityToken, nonce, authorizationCode?, name? }`.
   Yanıt normal oturumdur (`accessToken`, `refreshToken`, `user`) + `result: created | signed_in | linked`. Hız sınırı: IP başına 15 dakikada 30.
   - Geçerli bir oturum `Authorization: Bearer` ile gelirse sağlayıcı o hesaba bağlanır. Misafir hesabı kayıtlı hesaba yükseltilir:
     tasarımları kalır, cihaz bağı ve eski oturumları kapanır. Geçersiz bir Bearer 401 döner; sessizce yeni hesap açılmaz.
   - `name` Apple'dan yalnız ilk girişte gelir; uygulama o anda gönderir.

**Token doğrulama** (TOK-01, TOK-02)
- Yalnız RS256 kabul edilir; `alg=none` ve HS256 reddedilir.
- `iss`, `aud`, `exp` ve token yaşı kontrol edilir: Google için en çok 1 saat, Apple için 10 dakika, ±60 sn saat farkı.
- `aud` bizim client id listemizde olmalıdır (`GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS`).
- Anahtarlar sabit tablodaki JWKS adresinden gelir; token içindeki `kid` yalnız bu güvenilir küme içinde anahtar seçer.
- Nonce, token'ın kendisi için basıldığı kanıtlandıktan sonra silinir. Aynı nonce ikinci kez 401 alır.
- Hata kodları:
  - 401 `invalid_token`: token doğrulanamadı.
  - 503 `oauth_not_configured`: client id tanımlı değil.
  - 503 `oauth_unavailable`: sağlayıcının anahtar sunucusuna ulaşılamadı; istemci tekrar dener.

**Hesap bağlama** (ön-hesap ele geçirmeye karşı)
- Sağlayıcı hesabı (`provider + sub`) zaten biliniyorsa o hesaba girilir. Kayıtlı başka bir kullanıcının Bearer'ı ile gelirse
  409 `identity_in_use` döner.
- Aynı e-postayla bir hesap varsa bağlantı yalnız **iki taraf da e-postayı doğrulamışsa** kurulur. Aksi hâlde 409 `account_exists`
  döner: kullanıcı e-posta ve şifresiyle girip profilden bağlar. Doğrulanmamış hesap hiçbir zaman ele geçirilmez ya da sessizce birleştirilmez.
- Var olan bir hesaba bağlanınca kullanıcıya "hesabın bağlandı" e-postası gider. Askıya alınmış hesap 403 alır.
- Aynı sağlayıcı hesabıyla iki paralel ilk giriş tek hesap açar: benzersiz kısıt yarışı kazananın hesabına yönlendirilir.

**Bağlı yöntemler**
- `GET /me/identities` → `{ hasPassword, items: [{ provider, email, isPrivateEmail, createdAt, lastUsedAt }] }`.
- `DELETE /me/identities/:provider` (`google | apple`). Hesaba girmenin son yolu kaldırılamaz: şifre yok ve tek yöntemse
  409 `last_login_method` döner.
- KVKK dışa aktarımı `signInMethods` alanında bağlı yöntemleri listeler.

**Apple token iptali** (App Store 5.1.1(v))
- `authorizationCode` gelirse backend onu Apple'da refresh token ile değiştirir. Bunun için ES256 client secret kullanılır
  (`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`).
- Refresh token veritabanında AES-256-GCM ile şifreli tutulur (`FIELD_ENC_KEY`, amaç etiketi AAD olarak bağlı, KEY-01).
- Hesap silinince ya da Apple bağlantısı kaldırılınca `apple-revoke` işi kuyruğa girer: 6 deneme, üstel bekleme.
  Apple'ın token'ı zaten geçersiz saymasında iş başarılı biter.
- Kod değişimi başarısız olursa giriş yine tamamlanır; yalnız sonraki iptal yapılamaz (loglanır).

**Apple sunucu bildirimleri** (TOK-05): `POST /webhooks/apple { payload }`
- `payload` Apple imzalı JWT'dir; aynı doğrulamadan geçmeden hiçbir şey yazılmaz. Aynı bildirim 48 saat içinde tekrar gelirse yok sayılır.
- `consent-revoked`: saklı token silinir ve kullanıcının oturumları kapanır. Sonraki Apple girişi aynı hesaba ulaşır.
- `account-delete`: Apple bağlantısı silinir ve oturumlar kapanır.
- Apple Developer'da bildirim adresi `https://<api>/v1/webhooks/apple` olarak ayarlanır.

**Yapılandırma**
- `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS`: virgülle ayrılır. Boşsa ilgili giriş 503 döner.
- Apple anahtar üçlüsü birlikte verilir. `APPLE_PRIVATE_KEY` varsa `FIELD_ENC_KEY` (32 bayt, base64) zorunludur.
- Üretimde `APPLE_CLIENT_IDS` doluysa Apple anahtarı zorunludur. `FIELD_ENC_KEY` diğer sırlardan farklı olmalıdır.
- Mobil giriş ekranı (Apple/Google butonları, profilde bağlı yöntemler) henüz yapılmadı.

### 7.13 Zorunlu güncelleme (426) ve hata izleme — #8 (backend + AI servisi)

**Zorunlu güncelleme**
- Mobil uygulama her istekte `X-App-Platform: ios|android` ve `X-App-Version: 1.4.0` başlıklarını gönderir.
- Sürüm, ayarlardaki en düşük sürümün altındaysa her uç 426 döner:
  `{ error: { code: "update_required", message, minVersion, storeUrl } }`. Uygulama tam ekran güncelleme ekranı gösterir.
- Başlıkta platform yoksa kapı uygulanmaz. Bu web sitesini, admin panelini ve webhook'ları kapsar. Bu başlığı göndermeyen eski
  sürümler zorlanamaz; bu yüzden başlık ilk mağaza sürümünde olmalıdır.
- Biçimi bozuk sürüm en eski sürüm sayılır.
- `GET /app/version?platform=ios&version=1.3.0` →
  `{ platform, minVersion, latestVersion, storeUrl, updateRequired, updateAvailable }`.
  - Uygulama açılışında çağrılır: `updateAvailable` ise kapatılabilir bir uyarı, `updateRequired` ise zorunlu ekran gösterilir.
  - Bu uç ve `/health` 426 dönmez; eski sürüm de güncelleme bilgisini alabilir.
- Ayar: `appVersions: { ios: { min, latest, storeUrl }, android: { ... } }` (`PATCH /admin/settings`, gerekçe zorunlu, denetim kaydına girer).
  - Sürüm `major.minor.patch` biçimindedir ve `min ≤ latest` olmalıdır.
  - Mağaza bağlantısı yalnız `https://apps.apple.com/…` ya da `https://play.google.com/…` olabilir. Ele geçirilmiş bir admin hesabı
    kullanıcıları sahte bir siteye yönlendiremez.
  - Varsayılan `0.0.0`: kapı kapalı. Admin panelindeki form admin aşamasında eklenecek.

**Hata izleme (Sentry)** — LOG-02, KVKK
- `SENTRY_DSN` boşsa kapalıdır. Backend `@sentry/node`, AI servisi `sentry-sdk` kullanır.
- Yalnız beklenmeyen hatalar gönderilir:
  - Backend: 500 dönen istekler; tasarım işinde AI dışı hatalar; bildirim ve bakım kuyruğunda denemeleri biten işler.
  - AI servisi: yakalanmamış istisnalar.
  - 4xx ve sağlayıcı/içerik hataları (ör. güvenlik filtresi) gönderilmez.
- Raporlar yurt dışına çıktığı için kişisel veri taşımaz:
  - Kullanıcı kimliği, IP, çerez, istek gövdesi, sorgu dizesi, yerel değişkenler gönderilmez. Başlıklardan yalnız `user-agent`,
    `content-type`, `accept-language`, `x-request-id` ve uygulama sürümü kalır.
  - URL'ler sorgusuz ve rota kalıbıyla gider (`GET /v1/designs/:id`).
  - Bütün metinler maskelenir: e-posta, JWT, Bearer/Key token, imzalı URL parametreleri, push token, IP, data URI ve uzun base64.
  - Log satırlarından yalnız olay adı breadcrumb olarak gider. Raporu kendi loglarımıza `requestId` bağlar.
  - AI servisinde otomatik entegrasyonlar kapalıdır (Anthropic/httpx entegrasyonları prompt ve sağlayıcı URL'si kaydederdi).
- Doğrulama:
  - Birim testleri.
  - Gerçek bir 500 hatası yerel sahte Sentry'ye gönderildi. Rapordaki çalışma zamanı verisinde e-posta, token, çerez, IP, imza
    ve gövde bulunmadı.
- Üretim önerisi:
  - Sentry'de AB veri bölgesi seçilir ve "Prevent Storing of IP Addresses" açılır.
  - `SENTRY_RELEASE` olarak commit SHA verilir.
  - Mobil Sentry mobil aşamada eklenecek.

### 7.14 Yasal metinler ve KVKK başvuruları — #9 (backend)

**Yasal metinler** (`terms`, `privacy`, `ai_processing`, `marketing`; `tr` ve `en`)
- Metinler veritabanında sürümlü tutulur. Sürüm `YYYY-MM-DD` ya da aynı gün düzeltmesi için `YYYY-MM-DD.n` biçimindedir.
- İlk açılışta `assets/legal/*.md` taslakları `2026-11-01` sürümüyle yayınlanır. Bu metinler **taslaktır; yayından önce hukukçu
  incelemesi gerekir**.
- Yer tutucular (`{{controller.name}}`, `{{controller.address}}`, `{{controller.email}}`, `{{controller.kep}}`) ortam
  değişkenlerinden doldurulur: `LEGAL_CONTROLLER_NAME`, `LEGAL_CONTROLLER_ADDRESS`, `LEGAL_CONTACT_EMAIL`, `LEGAL_KEP_ADDRESS`.
  Üretimde ilk üçü zorunludur.
- Yayınlanmış metin değiştirilemez ve silinemez; kullanıcının neyi onayladığının kanıtıdır. Değişiklik yeni sürümle yapılır.
- `requiresConsent: false` ile yayınlanan sürüm (yazım düzeltmesi) eski onayları geçerli bırakır. `true` ise kullanıcıdan yeniden
  onay istenir: `/me/consents` içindeki `current.<tür>.granted` false olur.
- Onay yalnız yayındaki sürüm için verilebilir (eski sürüme 409). Geri çekme her zaman kabul edilir.
- Gövde Markdown'dur; HTML etiketi reddedilir (WEB-01). İstemciler metni HTML olarak işlemez.

| Metot | Yol | Gövde / sorgu | Yanıt |
|---|---|---|---|
| GET | `/legal` | `?locale=tr\|en` | `{ items: { kind, version, consentVersion, publishedAt, url }[] }` |
| GET | `/legal/:kind` | `?locale=tr\|en&version=` | `{ kind, version, locale, title, body, format: 'markdown', requiresConsent, publishedAt, current }`. Çeviri yoksa Türkçe döner; eski sürüm `version` ile okunur. |
| GET | `/admin/legal` | `?kind=` (SUPPORT) | `{ current, items: { id, kind, version, locale, title, requiresConsent, status: 'draft'\|'published', publishedAt, updatedAt }[] }` |
| GET | `/admin/legal/:id` | SUPPORT | Ham satır (yer tutucular doldurulmadan) |
| POST | `/admin/legal` | `{ kind, version, locale, title, body, requiresConsent }` (ADMIN) | 201 taslak. Sürüm yayındakinden büyük olmalı; aynı tür + sürüm + dil için 409. |
| PATCH | `/admin/legal/:id` | `{ title?, body?, requiresConsent? }` (ADMIN) | Taslak; yayınlanmışsa 409 |
| DELETE | `/admin/legal/:id` | ADMIN | 204; yayınlanmışsa 409 |
| POST | `/admin/legal/publish` | `{ kind, version, reason }` (ADMIN) | Sürümün bütün dilleri birlikte yayınlanır; Türkçe taslak zorunlu (400). `requiresConsent` Türkçe metinden alınır. Denetim kaydına gerekçeyle girer. |

`GET /catalog` yanıtındaki `legal` alanı (`termsVersion`, `privacyVersion`, `aiProcessingVersion`, `marketingVersion`) yayındaki
sürümleri gösterir; yayın sonrası en geç 60 sn içinde güncellenir.

**KVKK m.11 başvuruları** (m.13: en geç 30 gün içinde yanıt)
- Başvuru türleri: `info`, `access`, `transfers`, `rectification`, `erasure`, `third_party_notice`, `objection`,
  `compensation`, `other`.
- Uygulamadan gelen başvuruda kimlik doğrulaması oturumdur. E-posta, KEP ya da yazılı gelen başvuruyu admin geliş tarihiyle
  kaydeder; süre o günden işler.
- Başvuru numarası `KVKK-YYYY-XXXXXX` biçimindedir; son tarih geliş + 30 gündür.
- Kullanıcının aynı anda en çok 3 açık başvurusu olabilir (409 `too_many_open_requests`); günde en çok 5 başvuru (429).
- Durumlar: `RECEIVED → IN_PROGRESS → COMPLETED | REJECTED`. Kapatmak için yanıt zorunlu. Kapanan başvuru yeniden açılmaz.
  İki admin aynı anda kapatamaz (koşullu güncelleme, 409).
- Yanıt uygulamada görünür ve başvuru sahibine e-postayla gider; e-postada KVKK m.14 şikâyet hakkı hatırlatılır.
- Başvuru ve yanıt metni kişisel veridir: loglara, denetim kaydına ve e-posta konusuna girmez. E-postalarda yalnız başvuru
  numarası, konu ve tarih bulunur.
- Hesap silinince başvuru kaydı kalır, kullanıcı bağlantısı kaldırılır (işlemin kanıtı). Kapanan başvurular 2 yıl sonra
  `retention` işiyle silinir.
- `kvkk-deadlines` (günlük 09:00 TR): 7 gün içinde dolacak ya da gecikmiş açık başvurular `LEGAL_CONTACT_EMAIL` adresine ve
  ADMIN / SUPER_ADMIN'lere e-postayla bildirilir.
- `GET /me/export` yanıtında `dataRequests` alanı vardır.

| Metot | Yol | Gövde / sorgu | Yanıt |
|---|---|---|---|
| GET | `/me/data-requests` | — | `{ items: { id, reference, type, status, details, response, receivedAt, dueAt, closedAt }[] }` |
| POST | `/me/data-requests` | `{ type, details: string (10..2000) }` | 201 başvuru. Kullanıcıya alındı, `LEGAL_CONTACT_EMAIL` adresine bildirim e-postası gider. |
| GET | `/admin/data-requests` | `?status&overdue=true&cursor&limit` (SUPPORT) | `{ counts: { open, dueSoon, overdue }, items: (başvuru + { channel, contactEmail, userId, handledBy, daysLeft, overdue })[], nextCursor }`; son tarihe göre sıralı |
| GET | `/admin/data-requests/:id` | SUPPORT | Başvuru + `user` özeti |
| POST | `/admin/data-requests` | `{ type, channel: 'email'\|'kep'\|'letter'\|'other', contactEmail?, details, receivedAt (ISO), userId? }` (ADMIN) | 201; gelecek tarih reddedilir. Denetlenir. |
| PATCH | `/admin/data-requests/:id` | `{ status: 'IN_PROGRESS'\|'COMPLETED'\|'REJECTED', response? (10..5000) }` (ADMIN) | Güncel kayıt. Denetim kaydına yanıt metni girmez. |

Bekleyenler: admin panelinde metin düzenleyici ve başvuru masası (admin aşaması); mobilde onay yenileme ekranı ve başvuru formu
(mobil aşaması); metinlerin hukukçu incelemesi.

### 7.15 Dokunarak seçim (seçilen nesneyi değiştir) — backend + AI servisi + web
Casalume'un ana farkı: kullanıcı odadaki **bir nesneye dokunur** (yastık, koltuk, sehpa…) ve yalnız o değişir.
Tam oda araçları (`redesign` vb.) olduğu gibi kalır. Seçim yalnız `replace`, `declutter` ve `paint` araçlarında vardır;
katalogda bu araçların `needs.points` alanı `true` döner.
- Nokta: `{ x, y }`, fotoğrafın sol üst köşesinden 0..1 oranında. **Her nokta bir nesnedir**, en çok 8 nokta.
  Aynı türün hepsini seçmek için `target` yazılır (ör. `yastık`): SAM 3 metin istemiyle o türün hepsini bulur.
- AI servisinde her nokta SAM 3'e ayrı `object_id` ile ön plan noktası (`label: 1`) olarak, piksel koordinatıyla gider;
  maskelerin birleşimi kullanılır. `mock` modunda dokunulan yerin çevresine çizilen etiketli elips (`heuristic`) kullanılır.
- Otomatik kilitten farkı: seçim kullanıcının açık isteğidir, **sessizce düşmez**. Maske üretimden **önce** çıkarılır.
  - Hiçbir şey bulunamazsa (kapsam %0,5'ten az ya da %95'ten fazla) hiçbir görsel üretilmez: 422 `selection_failed`.
    SAM 3 maliyeti `usage` (`kind: 'segment'`) içinde döner ve kaydedilir; tasarım başarısız olur ve hak iade edilir.
  - Segmenter yoksa (`FAL_KEY` yok ya da `REGION_LOCK=off`) ya da fal.ai anahtarı/hesabı reddediyorsa (401/402/403; ör.
    bakiye bitti, "TOP_UP"): 503 `selection_unavailable`. İstemci yazarak seçime döner; hesap düzelince kendiliğinden açılır.
  - fal.ai hatası ya da zaman aşımı: 502 `ai_unavailable` (zaman aşımı yeniden denenebilir).
- Prompt'a seçimin yeri yazılır ("… 25–60 % from the left and 40–80 % from the top of the photo"). Çıktı yalnız maske içinde
  orijinalle birleştirilir; `region.target` değeri `target` ya da `selection` olur.
- Araç dışı kullanım reddedilir: başka araçta `points` ya da `points` ile `removeAll` → 400 (AI servisi: `selection_not_supported`).

| Yöntem | Yol | Gövde | Yanıt |
|---|---|---|---|
| POST | `/uploads/:id/selection` | `{ points?: [{x,y}] (1..8), target?: string (≤120) }` — en az biri | 200 `{ mask: 'data:image/png;base64,…', coverage, method: 'sam3'\|'heuristic' }` |
| POST | `/designs` | mevcut alanlar + `points?` | Önizlemedeki noktalar aynen gönderilir; maske üretimde yeniden çıkarılır (aynı girdi, aynı maske). |

- `/uploads/:id/selection` yalnız kullanıcının kendi görselinde çalışır (AZ-01: başkasınınki 404). Tasarım sonuçları da
  kullanıcınındır; sonuç üzerinde yeniden seçim yapılabilir. AI işleme onayı gerekiyorsa 403 `consent_required`.
- Her önizleme ücretli bir SAM 3 çağrısıdır (`FALAI_SEG_COST_USD`): kullanıcı başına 10 dakikada 60 (RES-01).
  Maliyet `AiUsage` içinde `kind: 'segment'` olarak görünür.
- Maske AI servisinde PIL ile yeniden kodlanır; backend PNG imzasını doğrulamadan tarayıcıya göndermez.
- AI servisi ucu: `POST /internal/v1/segment` `{ image_b64, points?, target? }` → `{ mask_b64, coverage, method, usage }`.
- Açık konu: fal SAM 3'te nokta istemi metinsiz gönderiliyor (`prompt` alanı yok). Belgede varsayılan `prompt` "wheel" olarak
  görünüyor; `FAL_KEY` girildikten sonra canlıda gerçek bir fotoğrafla denenip doğrulanacak.

### 7.16 Toplu Gönderim (admin → uygulama bildirimi) — backend + admin
fal-app'teki toplu gönderim modülünün Casalume'a uyarlanmış hali; gönderim Expo push ile yapılır. Admin menüsü:
**Kullanıcılar → Toplu Gönderim**. Okuma EDITOR, yazma ve gönderim ADMIN yetkisi ister; her yazma denetim kaydına girer.
- **Tür:**
  - `SERVICE` (Bilgilendirme): cihazı kayıtlı herkese gider. Ticari ifade içeremez (6563 sayılı Kanun / İYS):
    indirim, fiyat, PRO'ya geçiş, aciliyet, `/fiyatlar` bağlantısı gibi işaretler bulunursa 422 `looks_commercial`.
  - `MARKETING` (Kampanya): yalnız pazarlama izni **gönderim anında** geçerli olanlara gider. Kişi başına 7 günde en çok
    `settings.broadcast.weeklyMarketingCap` (varsayılan 2) kampanya. İstanbul saatiyle sessiz saatlerde (varsayılan
    21:00–09:00) gönderilmez; "şimdi gönder" ya da zamanlama, pencerenin bitimine kayar.
- **Kitle:** `{ plan?, platform?, locale?, accounts: all|registered|guests, inactiveDays? | activeDays?, registeredAfter?,
  registeredBefore?, emails? (≤500) }`. Yalnız `ACTIVE` ve `USER` rolündeki, en az bir push cihazı olan kullanıcılar sayılır.
  Üst sınır 100.000.
- **Bağlantı:** Yalnız uygulama içi yollar (`/studio`, `/tasarimlarim`, `/sohbet`, `/fiyatlar` ve tek bir sorgu
  parametresi), EXT-02. Push verisi: `{ type: 'broadcast', broadcastId, kind, url: 'casalume://studio', path }`.
  Android kanalı `news`; mobil uygulama bu kanalı oluşturmalı, oluşturmazsa varsayılan kanala düşer.
- **Akış:** `DRAFT` → (`SCHEDULED`) → `SENDING` → `SENT` | `FAILED` | `CANCELLED`.
  - Gönderim tek bir koşullu güncellemeyle sahiplenilir; ikinci "gönder" 409 alır, aynı gönderim iki kez gitmez.
  - Alıcı başına `BroadcastDelivery` satırı tutulur: `PENDING` → `SENDING` → `SENT` / `SKIPPED` / `FAILED` / `CANCELLED`.
    `reason` alanı: `no_device`, `consent_missing`, `weekly_cap`, `provider_error`, `interrupted`, `cancelled`, `inactive`.
  - En çok bir kez teslim: satır Expo çağrısından önce `SENDING` olur. Çöken bir turun satırları yeniden gönderilmez,
    `interrupted` olarak kapanır. Expo 429/5xx verirse tur geri alınır ve iş yeniden denenir.
  - `broadcasts` kuyruğu tek işçiyle (eşzamanlılık 1) çalışır; haftalık sınır yarış koşulu olmadan sayılır.
  - Zamanlanmış gönderimleri her dakika `broadcasts-due` başlatır; yarıda kalanlar 10 dakika sonra kaldığı yerden sürer.
- **KVKK:** Kişi başı teslim satırları 180 gün sonra silinir (gece bakımı); gönderimdeki sayaçlar kalır.

| Yöntem | Yol | Gövde | Not |
|---|---|---|---|
| GET | `/admin/broadcasts` | — | Sayfalı liste |
| GET | `/admin/broadcasts/links` | — | Seçilebilir uygulama içi bağlantılar |
| POST | `/admin/broadcasts/estimate` | `{ audience, kind }` | `{ withDevice, eligible }` (eligible: kampanyada izni olanlar) |
| POST | `/admin/broadcasts/precheck` | `{ title, body, link?, kind }` | `{ signals[], blocked }` |
| POST | `/admin/broadcasts` | `{ title (3–80), body (5–300), link?, kind, audience }` | 201 taslak |
| PATCH | `/admin/broadcasts/:id` | aynı | Yalnız DRAFT / SCHEDULED |
| POST | `/admin/broadcasts/:id/send` | — | 200; kampanya sessiz saatteyse `SCHEDULED` döner |
| POST | `/admin/broadcasts/:id/schedule` | `{ at (ISO) }` | 1 dakika – 60 gün sonrası |
| POST | `/admin/broadcasts/:id/cancel` | — | Süren gönderim bir sonraki turda durur |
| DELETE | `/admin/broadcasts/:id` | — | 204; gönderim sürerken 409. Metin denetim kaydında kalır |
| GET | `/admin/broadcasts/:id` | — | Sayaçlar, durum/neden dağılımı, son 50 alıcı |
| POST | `/admin/broadcasts/test` | `{ title, body, link?, kind, email }` | Yalnız o hesabın cihazlarına "[Test]" önekiyle; rapora yazılmaz. 10 dakikada 20 |
| POST | `/broadcasts/:id/opened` | — (kullanıcı oturumu) | 204; mobil uygulama bildirime dokunulunca çağırır, kişi başına bir kez sayılır |

#### 7.16.1 E-posta kanalı (maeyja kampanya modülü)
- `channel: 'PUSH' | 'EMAIL'` (varsayılan PUSH) gövdeye, tahmine ve teste eklenir. E-postada kitle, e-postası doğrulanmış
  kayıtlı kullanıcılardır (misafir yok); `platform` yok sayılır. Metin en çok 2.000 karakterdir (push'ta 300).
  Düz yazıdır: kaçışlanır, boş satır paragraf açar. `link` web'de `WEB_APP_URL + yol` düğmesi olur.
- Gönderim kendi posta sunucumuzdan saniyede bir e-postayla yapılır. Bütün gönderimlerde günde en çok
  `settings.broadcast.emailDailyCap` (varsayılan 300) e-posta gider; sınıra gelen gönderim ertesi gün kaldığı yerden sürer.
  E-postası doğrulanmamış alıcı `no_email` olarak atlanır.
- Kampanya e-postasında alt bilgide gönderen kimliği (`LEGAL_CONTROLLER_*`) ve imzalı **abonelikten çık** bağlantısı
  (`WEB_APP_URL/abonelikten-cik?r=<teslim>&t=<HMAC>`) bulunur. `List-Unsubscribe` ve `List-Unsubscribe-Post: One-Click`
  başlıkları eklenir (RFC 8058, Gmail/Yahoo toplu gönderici kuralı). Bağlantıda e-posta adresi geçmez.
  İmza anahtarı `JWT_SECRET`'tan alan ayrımıyla türetilir.
- Abonelikten çıkmak pazarlama iznini geri çekme olarak kaydedilir (`Consent kind=marketing granted=false`). Sonraki
  kampanyalar, gönderim anındaki izin kontrolünde bu kişiyi atlar.

| Yöntem | Yol | Gövde | Not |
|---|---|---|---|
| POST | `/unsubscribe` | `{ r, t }` | Herkese açık; web sayfası tıklamayla çağırır (bağlantı tarayıcıları açınca bir şey olmaz). 10 dakikada IP başına 30 |
| POST | `/unsubscribe/one-click?r=&t=` | — | Herkese açık; e-posta sağlayıcısının tek tık düğmesi |

### 7.17 Çok dilli sürüm (11 dil) — web + backend + AI servisi
Diller (maeyja ile aynı): `tr` (varsayılan), `en`, `de`, `es`, `fr`, `it`, `ru`, `nl`, `ja`, `ko`, `zh`.

**Web adresleri**
- Türkçe öneksizdir (`/studio`); diğer diller önekli (`/en/studio`, `/de/fiyatlar`). Yol adları her dilde aynı kalır.
- `src/proxy.ts`:
  - `/tr/...` → 308 ile öneksiz adrese.
  - Öneksiz istek: `air_locale` çerezi, yoksa `Accept-Language` (q değerleriyle) Türkçe dışı bir dil seçerse 307 ile o dile
    yönlenir. Arama motoru botları ve GET dışı istekler yönlendirilmez.
  - Kalan istek içeride `/tr/...` olarak işlenir.
- Dil seçici (üst menü) adresi değiştirir ve çerezi yazar.
- Bilinmeyen adres her dilde o dilin 404 sayfasını gösterir.
- `sitemap.xml`: her sayfa her dilde, `hreflang` + `x-default` ile. `robots.txt`: özel sayfalar her dil önekiyle kapalı.

**Metinler**
- Web metinleri `apps/web/src/messages/<dil>.json` dosyalarındadır. Kaynak `tr.json`, `en.json` başvuru içindir.
- Eksik anahtar sunucuda İngilizceyle doldurulur.
- Yer tutucular `{n}` biçimindedir; `fmt()` doldurur.

**Çeviri doldurma (`scripts/i18n_fill.py`)**
- Yalnız eksik anahtarları çevirir; Claude Opus 5.5 kullanır, yapılandırılmış çıktıyla çalışır.
- Yer tutucusu Türkçeyle tutmayan çeviriyi reddeder.
- Çalıştırma:
  ```
  python scripts/i18n_fill.py --dir apps/web/src/messages --locales de,ja
  ```
  `ANTHROPIC_API_KEY` ortamdan okunur.
- Yeni bir Türkçe metin eklenince betik yeniden çalıştırılır.

**Backend**
- `localeOf()` sırası: `?locale=` → `Accept-Language` (q değerleri) → kullanıcının kayıtlı dili → `tr`.
- `locale` alanı (kullanıcı, tasarım listesi, sohbet, toplu gönderim kitlesi) 11 dili kabul eder.
- Katalog adları (araç, oda, zemin, renk, plan, stil):
  - Türkçe ve İngilizce koddan / admin'den gelir.
  - Diğer diller `apps/backend/assets/i18n/catalog/<dil>.json` dosyasından okunur (kaynak `npm run i18n:catalog`, çeviri
    `i18n_fill.py --dir apps/backend/assets/i18n/catalog`).
  - Çevirisi olmayan ad (ör. admin'de yeni eklenen stil) İngilizce döner.
- Yalnız Türkçe ve İngilizce yazılan metinler (e-posta, push, admin duyurusu, yasal metinler): Türkçe kullanıcıya Türkçe,
  diğer herkese İngilizce. `GET /v1/legal?locale=de` İngilizce metni döner; yasal metnin başka dile çevirisi hukuk
  onayı ister.

**AI servisi**
- Sohbet ve maliyet analizi 11 dilde yanıt verir (`locale`).
- Görsel talimatları İngilizce kalır.

### 7.18 Pazarlama ajanları — backend + admin + AI servisi + web
Ajanlar yalnız **taslak** üretir. Buradan hiçbir şey yayınlanmaz ya da gönderilmez (AI-02). Taslağı sahibi düzenler ve
onaylar; mağazaya yüklemeyi kendisi yapar.

**Bilgi sayfası (`GET /admin/marketing/facts?locale=`)**
- Canlı katalogdan ve ayarlardan üretilir: araçlar, stiller, odalar, günlük ücretsiz hak, planlar.
- Araç, stil ve oda adları o dilde uygulamanın gösterdiği adlardır.
- Fiyat yazılmaz; mağaza ülkesine göre değişir.
- Ajan yalnız buradaki gerçekleri kullanır: özellik, ödül, kullanıcı sayısı ya da puan uyduramaz.

**Mağaza metni**
- Her dil kendi pazarı için ayrı yazılır, çeviri değildir.
- Alanlar ve sınırlar (karakter):

  | Mağaza | Alanlar |
  |---|---|
  | App Store | ad 30, alt başlık 30, anahtar kelime 100, tanıtım metni 170, açıklama 4000, yenilikler 4000 |
  | Google Play | başlık 30, kısa açıklama 80, tam açıklama 4000 |

- AI servisi (`POST /internal/v1/marketing/aso`):
  - Claude Opus 5.5 ile yapılandırılmış çıktı üretir.
  - Sınırı aşan alanları bir kez yeniden yazdırır; hâlâ aşan alanı kesmez, `violations` içinde bildirir.
  - Anahtar kelimelerden ad ve alt başlıktaki sözcükleri, tekrarları ve virgül sonrası boşlukları atar.
- Bir dil yaklaşık 45–60 saniye sürer ve 0,09–0,11 $ tutar. Maliyet `AiUsage` defterine `kind=marketing` olarak yazılır.

**Akış**
- Her dil bir taslaktır (`MarketingDraft`) ve arka planda yazılır (`marketing` kuyruğu, aynı anda 3 dil).
- Durumlar: `PENDING` → `READY` | `FAILED` → `APPROVED` → `ARCHIVED`.
- Geçici AI hatası bir kez yeniden denenir. Bir saatten uzun `PENDING` kalan taslak `FAILED` (`timeout`) olur.
- Düzenleme sunucuda mağaza sınırlarıyla denetlenir. Onaylı taslak düzenlenirse yeniden onay ister.
- Sınırı aşan alanı olan taslak onaylanamaz (422 `over_limit`).
- Onaylanan taslak o dilin güncel metni olur; önceki onaylı metin arşivlenir.
- Günlük AI bütçesi dolduysa yazım başlamaz (503 `budget_exceeded`). Yazılmakta olan dil yeniden başlatılamaz (409).
- Hız sınırı: admin başına saatte 10 çalıştırma.

**Dışa aktarma**
- `appStore`: EAS Metadata `store.config.json` (`apple.info.<locale>`: `title`, `subtitle`, `description`, `keywords`,
  `releaseNotes`, `promoText`). Mobil tarafta `eas metadata:push` ile yüklenir.
- `googlePlay`: Play Console dil kodu başına `title`, `shortDescription`, `fullDescription`, `releaseNotes`.

| Yöntem | Yol | Rol | Not |
|---|---|---|---|
| GET | `/admin/marketing/facts?locale=` | EDITOR | Ajana verilen bilgi sayfası |
| GET | `/admin/marketing/aso` | EDITOR | Arşivlenmemiş taslaklar (en çok 200) |
| POST | `/admin/marketing/aso` | EDITOR | `{ locales[], brief?, whatsNew? }` → 202, dil başına taslak |
| GET | `/admin/marketing/aso/export` | EDITOR | Onaylı metinler: `{ locales, appStore, googlePlay }` |
| PATCH | `/admin/marketing/drafts/:id` | EDITOR | `{ output }`; mağaza sınırları denetlenir |
| POST | `/admin/marketing/drafts/:id/approve` | ADMIN | Dilin güncel metni olur |
| POST | `/admin/marketing/drafts/:id/archive` | EDITOR | |

Bütün yazma işlemleri denetim kaydına girer: `marketing.aso_run`, `.edit`, `.approve`, `.archive`.

Taslaklar ortak uçtan okunur: `GET /admin/marketing/drafts?kind=aso|social|campaign|report|blog|seo` (EDITOR).
Her çalıştırma (`POST /admin/marketing/<tür>`) aynı bütçe kesicisine ve saatte 10 çalıştırma sınırına tabidir.

#### 7.18.1 Sosyal medya gönderisi
- Görsel yalnız bizim fotoğraflarımızdır, kullanıcı fotoğrafı kullanılmaz (KVKK):
  - "Önce": örnek salon. "Sonra": o salondan üretilmiş stil fotoğrafı.
  - Stil fotoğrafının "Yapay zekâ ile oluşturulmuştur" etiketi kırpılmaz; iki fotoğraf alttan hizalanır.
- Biçimler: `square` 1080×1080, `story` 1080×1920, `pin` 1000×1500; alt şeritte `casalume.app` yazar.
  `GET /admin/marketing/drafts/:id/image?format=` → `{ dataUrl, width, height }`.
- Metin: platforma göre `title` ≤100, `caption` (Instagram/TikTok ≤2200, Pinterest ≤500), `hashtags` ≤5 (`#`
  olmadan), `alt_text` ≤250. Fiyat yok; "sonra"nın yapay zekâ tasarımı olduğu açıkça yazılır.
- `POST /admin/marketing/social` `{ styleIds[≤5], platforms[], locales[], brief? }`: stil × platform × dil, en çok 30.
- `GET /admin/marketing/social/styles`: kullanılabilecek stiller (örnek odadan fotoğrafı olanlar).
- Paylaşım elle yapılır; TikTok'ta "AI ile oluşturuldu" etiketi açılmalıdır.

#### 7.18.2 Kampanya metni
- `POST /admin/marketing/campaign` `{ locales[], channel: PUSH|EMAIL, kind: SERVICE|MARKETING, goal }`: dil başına
  bir metin.
- Sınırlar: PUSH başlık ≤50, metin ≤300; EMAIL konu ≤80, metin ≤2000.
- Bağlantı yalnız uygulama içi yollardan seçilir; `/fiyatlar` yalnız kampanya türünde sunulur.
- Toplu Gönderim'in ticari ifade kontrolü taslakta da çalışır. "Bilgilendirme" metninde ticari ifade varsa ihlal
  `looks_commercial` olur ve metin onaylanamaz.
- `POST /admin/marketing/drafts/:id/broadcast` (ADMIN): onaylı metin, o dildeki kullanıcılara giden bir Toplu
  Gönderim **TASLAĞI** olur (`audience.locale`). Bir metinden bir kez açılır. Gönderim Toplu Gönderim ekranından,
  kendi kurallarıyla (izin, haftalık sınır, sessiz saatler) yapılır.

#### 7.18.3 Haftalık rapor
- Her pazartesi 09:00 (İstanbul) zamanlı iş `weekly-report` çalışır. Elle tetiklemek için
  `POST /admin/marketing/report` `{ send }` (ADMIN).
- Son 7 gün ile önceki 7 gün karşılaştırılır:
  - kayıt, misafir, aktif kullanıcı
  - başarılı ve hatalı tasarım
  - yeni abonelik, yenileme, iptal, kredi paketi
  - AI maliyeti ve tasarım başına maliyet
  - hatalı zamanlı iş, gönderilen toplu ileti
  - en çok kullanılan araç ve stiller
  - açık içerik bildirimi ve KVKK başvurusu
- Yalnız sayılar vardır, kişisel veri yoktur.
- Claude'un Türkçe yorumu eklenir (özet, öne çıkanlar, öneriler). Yorum alınamazsa sayılar yine gider.
- Rapor SUPER_ADMIN adreslerine e-postayla gider.

#### 7.18.4 Blog
- `BlogPost`: dil başına bir satır; çeviriler `groupId` paylaşır (hreflang). `(locale, slug)` benzersizdir.
- `POST /admin/marketing/blog` `{ topic, keywords?, locale=tr, styleId? }`: 700–1100 sözcüklük yazı. Kapak, stilin
  fotoğrafıdır.
- `POST /admin/marketing/blog/translate` `{ postId, locales[] }`: yayındaki yazının diğer dillere uyarlanması.
- Taslak sınırları: başlık ≤70, açıklama 50–160, adres `^[a-z0-9]+(-[a-z0-9]+)*$` ≤80, metin 200–30000.
- Onay (ADMIN) yazıyı **yayına alır**. Adres o dilde başka bir yazıda kullanılıyorsa 409 `slug_taken` döner.
- `POST /admin/blog/:id/unpublish|publish` (ADMIN); `GET /admin/blog`.
- Herkese açık uçlar:
  - `GET /v1/blog?locale=`
  - `GET /v1/blog/:slug?locale=` (`translations` ile)
  - `GET /v1/blog/sitemap`
- Web:
  - Adresler `/blog` ve `/<dil>/blog/<adres>`.
  - Metin küçük bir Markdown alt kümesidir (`##`, `###`, listeler, kalın/eğik, bağlantı). HTML olarak değil React
    öğeleri olarak çizilir (WEB-01).
  - Yalnız `/studio`, `/fiyatlar`, `/sohbet`, `/blog…` bağlantıları çalışır; diğerleri düz metin olur (EXT-02).
  - Sayfada canonical, hreflang ve Open Graph bulunur. Site haritasına yazılar eklenir.
  - Önbellek birkaç dakikadır: onaylanan yazı deploy gerekmeden sitede görünür.

#### 7.18.5 SEO
- `POST /admin/marketing/seo` `{ locales[] }`: dil başına ana sayfa, stüdyo, fiyatlar, sohbet ve blog için başlık
  (≤60) ve açıklama (≤160).
- Eksik sayfa ihlal olarak bildirilir (`<sayfa>.missing`).
- Onaylanan metin o dilin güncel SEO metni olur; öncekisi arşivlenir.
- `GET /v1/seo/meta?locale=` → `{ pages: { home: { title, description }, … } }`.
- Web bu metni birkaç dakikalık önbellekle sayfa başlığına ve açıklamasına uygular. Onaylı metin yoksa ya da API
  yanıt vermezse sitenin kendi metni geçerlidir.

### 7.19 Destek talepleri — backend + admin + web (mobil sonra)
Kullanıcı web'den (`/destek`) ya da uygulamadan talep açar; ekip admin'de (**Destek**) yanıtlar. Yanıt kullanıcıya
e-posta (yalnız doğrulanmış adres) ve push ile gider. Kullanıcı yalnız kendi taleplerini görür (AZ-01).

**Kurallar**
- Tür: `bug | billing | account | design | idea | other`. Başlık 3–120, mesaj 10–4000 (cevaplarda 1–4000) karakter.
- `requestId`: hata ekranından açılırken backend'in `X-Request-Id`'si gönderilir; ekip logda arar. Web, BFF'den gelen bu
  başlığı hata kutusundaki "Destek'e yaz" bağlantısına ekler.
- Aynı anda en çok 5 açık talep; saatte 5 yeni talep, 30 mesaj.
- Durum: `OPEN` → (ekip yanıtı) `ANSWERED` → (ekip) `CLOSED`. Kullanıcı cevap yazınca talep `OPEN` olur.
- `userUnread`: okunmamış ekip yanıtı; kullanıcı talebi açınca düşer.
- Ekibe yeni talep e-postası (`LEGAL_CONTACT_EMAIL`): yalnız numara, tür ve başlık; mesaj panelde kalır.
- Kullanıcıya yanıt e-postası Türkçe ya da İngilizce (diğer diller İngilizce), bağlantı `WEB_APP_URL/<dil>/destek?t=<id>`.
- Push: `data: { type: 'support', ticketId, url: 'casalume://support/<id>', path: '/destek?t=<id>' }`, Android kanal
  `designs` (mobil `support` kanalı ekleyince değiştirilebilir).
- Hesap silinince talepler de silinir; kapanmış talepler 2 yıl sonra silinir (retention). Talepler veri indirme
  (`/me/export` → `supportTickets`) çıktısında yer alır.

| Yöntem | Yol | Rol | Not |
|---|---|---|---|
| GET | `/me/support` | kullanıcı | Taleplerim (son mesaja göre, en çok 50) |
| POST | `/me/support` | kullanıcı | `{ category, subject, body, requestId?, designId?, platform?, appVersion? }` → 201 |
| GET | `/me/support/:id` | kullanıcı | Talep + mesajlar; yanıtı okunmuş sayar |
| POST | `/me/support/:id/messages` | kullanıcı | `{ body }` → talep yeniden açılır |
| GET | `/admin/support?status=&cursor=&limit=` | SUPPORT | Liste + `counts` (OPEN/ANSWERED/CLOSED) |
| GET | `/admin/support/:id` | SUPPORT | Talep, mesajlar, kullanıcı özeti |
| POST | `/admin/support/:id/reply` | SUPPORT | `{ body }` → ANSWERED, e-posta + push |
| POST | `/admin/support/:id/close` | SUPPORT | CLOSED |

Mobil (sonra): Profil → Destek ekranı aynı `/me/support` uçlarını kullanır; `platform: 'ios' | 'android'` ve
`appVersion` gönderilir; `casalume://support/<id>` derin bağlantısı talebi açar.

### 7.20 Analiz — backend + admin
Admin'de **Analiz** (Genel altında): gelir, etkileşim ve haftalık kohort tutma. Yalnız okuma; yalnız sayılar ve toplamlar
döner, kişisel veri dönmez. Günler İstanbul takvim günü, haftalar pazartesi başlar. Yönetici hesapları (rol ≠ USER)
kullanıcı sayılarına girmez.

**Gelir** (ADMIN ve üstü)
- Kaynak: saklanan RevenueCat olayları (`WebhookEvent.payload`). `price` USD'dir (deneme 0, iade negatif).
- Gelir: ücretli `INITIAL_PURCHASE`, `RENEWAL`, `NON_RENEWING_PURCHASE` (kredi paketi). İade: `CANCELLATION` +
  `cancel_reason: CUSTOMER_SUPPORT`. Başka iptaller yalnız yenilemeyi kapatır, tutardan düşmez. `PRODUCT_CHANGE`
  sayılmaz.
- Gün: olayın `event_timestamp_ms` değeri (yoksa alınma zamanı).
- Ele geçen: `commission_percentage` ve `tax_percentage` düşülür; olay bildirmediyse brüt sayılır.
- MRR: şu an erişimi olan, yenilenecek (deneme ve iptal edilmemiş) aboneliklerin son ödenen fiyatı, aylığa çevrilir.
  Dönem `expiration_at_ms − purchased_at_ms` ile bulunur.
- `env=SANDBOX` test satın almalarını ayrı gösterir. Ortam bilgisi olmayan olay canlı (PRODUCTION) sayılır.
- Bir istekte en çok 50.000 olay okunur; aşılırsa `truncated: true` döner.

**Etkileşim ve kohort** (SUPPORT ve üstü)
- Aktif kullanıcı: o gün tasarım isteyen ya da AI özelliği (sohbet, analiz, nesne seçimi, referans stil) kullanan kişi.
- Yapışkanlık: son 30 günün ortalama günlük aktifi ÷ 30 günlük aktif.
- Huni: aralıkta hesabı açılanlar → ilk tasarım → başarılı sonuç → 3+ tasarım → e-postayla kayıt → satın alma.
  Her adım, hesabı açılanlara oranlanır.
- Kohort: hesabın açıldığı hafta. `retention[k]`, k. haftada aktif olanların yüzdesidir (0 = kayıt haftası).
  Henüz gelmemiş haftalar `null` döner. `average` her kohortu büyüklüğüyle tartar.

| Yöntem | Yol | Rol | Not |
|---|---|---|---|
| GET | `/admin/analytics/revenue?days=30&env=PRODUCTION` | ADMIN | `days` 7–365. Döner: `totals`, `daily`, `byProduct`, `byStore`, `byCurrency`, `subscriptions` (`mrrUsd`, `active`, `byStatus`, `trials`), `truncated` |
| GET | `/admin/analytics/engagement?days=30` | SUPPORT | `days` 7–90. Döner: `active` (`today`, `week`, `month`, `period`, `returning`, `stickiness`), `daily`, `funnel`, `designs`, `reach` |
| GET | `/admin/analytics/cohorts?weeks=8&segment=all` | SUPPORT | `weeks` 4–12, `segment` `all` ya da `registered`. Döner: `rows` (`week`, `size`, `active[]`, `retention[]`), `average[]` |

Not: Panodaki ve AI maliyetindeki günlük seriler artık `(createdAt AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul'`
ile gün ayırır. Sütunlar UTC tutan `timestamp`; eski ifade sonucu veritabanı oturumunun saat dilimine bağlıyordu. UTC
çalışan bir sunucuda gün sınırı 6 saat kayıyordu.

Mobil: yok (yalnız admin).

### 7.21 Planlar, kredi paketleri ve aboneler — backend + admin (mobil sonra)
Admin'de iki sayfa var, ikisi de **Gelir ve maliyet** altında:
- **Planlar ve paketler:** ödeme ekranında görünen Pro planı, abonelik dönemleri ve kredi paketleri.
- **Abonelikler:** RevenueCat'ten eşitlenen abone durumları.

Fiyat hiçbir yerde tutulmaz. Fiyatı mağaza belirler; uygulama RevenueCat tekliflerindeki yerel fiyatı gösterir.

**Katalog**
- `Setting` tablosunda `billing.catalog` anahtarıyla tek satır olarak tutulur.
- Hiç kaydedilmediyse paketler `CREDIT_PACKS` ortam değişkeninden gelir. Davranış ilk kayda kadar değişmez.
- Pro plan alanları: Türkçe ve İngilizce ad, kısa açıklama ve özellik satırları (en çok 8). Dönemler
  (`weekly | monthly | yearly`) her biri için satışta mı, öne çıkan mı, iOS ve Android ürün kimliği.
- Kredi paketi alanları (en çok 6): `key`, iki dilde ad, `credits` (1–10.000), iOS ve Android ürün kimliği,
  öne çıkan, satışta.
- Kurallar:
  - Bir ürün kimliği tek bir şeydir: iki paket ya da hem dönem hem paket olamaz. iOS ve Android aynı kimliği
    kullanabilir.
  - Satıştaki giriş en az bir ürün kimliği ister.
  - Dönemlerde ve paketlerde en çok birer öne çıkan olur.
- Kredi kararı: RevenueCat'ten gelen `NON_RENEWING_PURCHASE`, ürün kimliğinin katalogdaki paketinin `credits`
  değeri kadar hak verir. Paket satışta olmasa da bu geçerlidir. Katalogdan çıkarılan paketin ürünü `retired`
  listesinde kalır; geç gelen ya da yeniden işlenen satın alma yine hakkını alır. Katalogda olmayan ürün hak
  vermez ve loga yazılır (`billing_unknown_pack`).
- Kredi her satın almada katalogdan taze okunur. Ödeme ekranı en çok 15 saniyelik önbellekten okunur.
- Kaydetme kuralları:
  - Gerekçe zorunludur.
  - `version` okunan `updatedAt` değeridir (hiç kaydedilmediyse `null`). Arada başkası kaydettiyse 409 döner
    (danışma kilidi + iyimser sürüm).
  - Denetim kaydı `billing.catalog_update`; yalnız değişen kısımlar yazılır, örnek:
    `pack.credits:pack_1:10->12`, `pack.removed:…`.

**Aboneler**
- `status`: `active | trial | cancelled | grace | billing_issue | expired`. Süresi dolmamış deneme `trial` sayılır,
  `active` sayılmaz.
- `env=SANDBOX` test satın almalarını gösterir. Ortamı bilinmeyen abonelik canlı sayılır.
- `q`: e-posta parçası ya da kullanıcı kimliği.
- Eşitleme RevenueCat REST'ten yeniden okur. `REVENUECAT_API_KEY` yoksa 409 döner. Yönetici başına sınırlıdır ve
  `billing.sync` olarak denetlenir.

| Yöntem | Yol | Rol | Not |
|---|---|---|---|
| GET | `/billing/catalog?locale=tr` | herkes | Ödeme ekranı: `plan` (`name`, `tagline`, `features`, `cycles[]` → `cycle`, `highlight`, `productIds { ios, android }`), `packs[]` (`key`, `name`, `credits`, `highlight`, `productIds`), `limits` (`free`/`pro` → `dailyGenerations`, `maxVariants`). Yalnız satıştakiler. `locale` tr değilse İngilizce |
| GET | `/admin/billing/catalog` | SUPPORT | Düzenleme görünümü: `catalog`, `version`, `saved`, `updatedAt`, `updatedBy`, `retiredProducts`, `limits`, `revenuecatRest` |
| PATCH | `/admin/billing/catalog` | ADMIN | `{ catalog, reason, version }` → 200 güncel görünüm. 400 (kural; ileti hangi alan olduğunu söyler), 409 (sürüm) |
| GET | `/admin/subscriptions?status=&env=&q=&cursor=&limit=` | SUPPORT | `items[]` (`userId`, `email`, `productId`, `store`, `periodType`, `status`, `expiresAt`, `access` …), `nextCursor`, `counts` |
| POST | `/admin/subscriptions/:userId/sync` | ADMIN | → `{ subscription }`. 409 REST anahtarı yok, 502 RevenueCat yanıt vermedi |

Mobil (sonra): ödeme ekranı `GET /v1/billing/catalog?locale=<dil>` ile metinleri, öne çıkanı ve paketlerin hak
sayısını alır. RevenueCat teklifleriyle `productIds` üzerinden eşleştirir; fiyatı RevenueCat'in `priceString`
değerinden gösterir. Katalogda olmayan teklif gösterilmez. Yanıt alınamazsa yalnız RevenueCat teklifleri gösterilir.

### 7.22 Hoş geldin kredisi — backend + admin + web (mobil sonra)
Kayıtlı ve kimliğini kanıtlamış yeni hesap bir kez hediye kredi alır. Miktar **Ayarlar → Kota ve varyantlar →
Hoş geldin kredisi** alanından ayarlanır (`welcomeCredits`, 0–50; 0 kapalı, varsayılan 0). Misafir hesap almaz;
onun günlük ücretsiz hakkı var.

**Ne zaman verilir**
- E-posta adresinin ilk doğrulanmasında. Şifre sıfırlama bağlantısı da adresi kanıtlar; adres o sırada ilk kez
  doğrulanıyorsa kredi orada verilir.
- Apple ya da Google ile yeni hesap açılınca ya da misafir hesap bu yolla kayıtlı hesaba dönünce.
- Var olan hesaba sonradan Apple/Google bağlamak kredi vermez.

**Bir kez kuralı (BUS-01)**
- Her kimlik `DEVICE_PEPPER` ile anahtarlanmış özet (HMAC) olarak `WelcomeGrant` tablosunda tutulur. Kimlik,
  normalize edilmiş e-posta ya da `apple:<sub>` / `google:<sub>` biçimindedir.
- Normalize kuralı: büyük-küçük harf ve Unicode biçimi eşitlenir, `+etiket` atılır, Gmail'de noktalar da atılır.
- Satır hesaba bağlı değildir: hesap silinince kalır, aynı kimlik yeniden açılan hesapta krediyi bir daha alamaz.
- Bir hesap krediyi bir kez alır (defterde `welcome` satırı). Aynı anda gelen iki hesaptan yalnız özeti ilk yazan
  alır.
- Özetler 3 yıl sonra saklama işinde silinir (`retention` → `welcomeGrants`). Adresin kendisi saklanmaz.
  Gizlilik metnine "kötüye kullanımı önlemek için kimliğin geri döndürülemez özeti 3 yıl tutulur" cümlesi
  eklenmeli (sahibinin işi).
- Hata kayıt akışını bozmaz; kredi verilemezse 0 döner ve loga yazılır.

**Yanıtlar**
- `POST /auth/email/verify` → `{ ok, welcomeCredits }`: verilen miktar, verilmediyse 0. Web doğrulama sayfası
  mesajı 11 dilde gösterir.
- `POST /auth/oauth/{provider}` yanıtına `welcomeCredits` eklendi.
- `GET /catalog` → `welcomeCredits`: şu anki ayar. Uygulama ve web "kayıt ol, N kredi kazan" diyebilir.

Aynı değişiklikle `GET /catalog` içindeki `creditPacks` artık `CREDIT_PACKS` ortam değişkeninden değil, plan
kataloğundaki satıştaki paketlerden gelir (§7.21). Her mağaza ürün kimliği ayrı satırdır.

Admin: kullanıcı ayrıntısındaki kredi hareketleri okunur etiketle görünür (Hoş geldin hediyesi, Tasarım, İade,
Kredi paketi, Yönetici).

Mobil (sonra): Apple/Google girişi yanıtındaki `welcomeCredits > 0` ise kısa bir kutlama gösterilir. Kayıt
ekranında `catalog.welcomeCredits` varsa teklif yazılır.

### 7.23 Firmalar (kurumsal hesap) — 1. adım: backend + admin
Hedef: mimarlık ofisleri, mobilya/dekor mağazaları, emlak/inşaat firmaları, otel/kafe zincirleri. Bu adımda firma,
roller ve ortak kredi havuzu admin'den yönetilir (**Kullanıcılar → Firmalar**). Ödeme panelden elle tanımlanır,
fatura dışarıda kesilir.

**Model**
- `Organization`: ad, durum (`ACTIVE | SUSPENDED`), `credits` havuzu, üye başı aylık sınır (`memberMonthlyCap`,
  boş sınırsız), ekip içi not.
- `OrgMember`: rol (`OWNER | ADMIN | MEMBER`), kişiye özel `monthlyCap`.
- `OrgLedger`: havuz hareketleri; ekip yüklemesi `actorId` ile, üye harcaması `userId` ile tutulur.

**Kurallar**
- Üye, kayıtlı + e-postası doğrulanmış + etkin + yönetici olmayan hesap olmalı (yoksa 404/422). Yönetici
  hesapları panel içindir. Bir kişi en çok 10 firmada, bir firmada en çok 200 üye olabilir.
- Sahip tektir: `OWNER` yalnız devirle verilir. Devirde eski sahip `ADMIN` olur. Sahibin rolü düzenlenemez,
  sahip çıkarılamaz (409 `owner_transfer_required`). Sahibi hesabını silerse firma sahipsiz kalır; panel uyarır,
  bir üyeye sahiplik verilir.
- Havuz eksiye inemez (BUS-01): koşullu tek adımlık güncelleme ve veritabanı CHECK kısıtı (`credits >= 0`).
  Yetmezse 409 `insufficient_credits`.
- Üye ve sahip işlemleri firma satırı kilitlenerek yapılır. Başka firmanın üyesine bu firmanın kimliğiyle
  ulaşılamaz (404, AZ-04).
- Her değişiklik gerekçe ister ve denetime yazılır: `org.create`, `org.update`, `org.credits`, `org.member_add`,
  `org.member_update`, `org.owner_transfer`, `org.member_remove`.
- Veri indirme (`/me/export`) `organizations` listesini içerir: firma adı, rol, sınır, katılma tarihi. Başka
  üyelerin verisi yer almaz.
- "Bu ay" kullanımı İstanbul takvim ayıdır: üyenin `generation` harcamaları eksi `refund` iadeleri. Harcama
  2. adımda başlar.

| Yöntem | Yol | Rol | Not |
|---|---|---|---|
| GET | `/admin/orgs?q=&status=&cursor=&limit=` | SUPPORT | Ad, sahip e-postası ya da kimlikle arama |
| GET | `/admin/orgs/:id` | SUPPORT | Firma, sahip, üyeler (bu ayki kullanım, geçerli sınır), son 50 kredi hareketi |
| POST | `/admin/orgs` | ADMIN | `{ name, ownerEmail, credits?, memberMonthlyCap?, note?, reason }` → 201 |
| PATCH | `/admin/orgs/:id` | ADMIN | `{ name?, status?, memberMonthlyCap?, note?, reason }` |
| POST | `/admin/orgs/:id/credits` | ADMIN | `{ delta, reason }` → 201; eksiye inerse 409 |
| POST | `/admin/orgs/:id/members` | ADMIN | `{ email, role: ADMIN\|MEMBER, monthlyCap?, reason }` → 201 |
| PATCH | `/admin/orgs/:id/members/:userId` | ADMIN | `{ role?, monthlyCap?, reason }`; `role: OWNER` sahipliği devreder |
| POST | `/admin/orgs/:id/members/:userId/remove` | ADMIN | `{ reason }`; sahip çıkarılamaz |

#### 7.23.2 Davet ve firma çalışma alanı (2. adım)

**Davet**
- Admin'den gönderilir: firma ayrıntısı → **Bekleyen davetler** → e-posta, rol (`ADMIN | MEMBER`), aylık sınır.
  Firmanın kendi yöneticilerinin davet göndermesi 3. adımda gelecek.
- Bağlantı: `WEB_APP_URL[/<dil>]/davet#token=<43 karakter>`. Adres isteğin Host başlığından değil, ortamdan kurulur
  (MAIL-01). Jeton URL parçasında (`#`) durur, sunucu loglarına girmez; veritabanında yalnız SHA-256 özeti tutulur.
- 7 gün geçerli ve tek kullanımlık (koşullu güncelleme). Aynı adrese yeniden davet eski bağlantıyı geçersiz kılar.
  Bir firmada en çok 50 bekleyen davet olur. Askıdaki firma davet gönderemez.
- Kabul kuralları:
  - Yalnız davetin gönderildiği adresle, kayıtlı, doğrulanmış, etkin ve yönetici olmayan hesap kabul eder.
  - Yanlış adres: 403 `invite_email_mismatch`, iletide maskeli adres (`a***@alan`).
  - Doğrulanmamış adres: 403 `email_not_verified`.
  - Misafir: 403 `registration_required`.
  - Yönetici hesabı: 422 `staff_account`.
  - Süresi dolmuş, kullanılmış ya da geri alınmış davet: 410.
  - Aynı hesapla ikinci kabul zararsızdır (`already: true`).
- Web `/davet` sayfası (11 dil):
  - Firma, rol ve maskeli adresi gösterir.
  - Giriş yapılmamışsa bağlantıyı tarayıcı oturumunda (sessionStorage) tutar; giriş ya da kayıt sonrası sayfaya döner.
  - Arama motorlarına kapalıdır.
- Kapanmış davetler 90 gün sonra silinir (`retention` → `orgInvites`).
- Denetim kaydı: `org.invite`, `org.invite_revoke`, `org.invite_accept`.

**Firma çalışma alanı**
- `POST /designs` gövdesine `orgId` eklenince tasarım firma alanında açılır:
  - PRO araç, stil ve varyant sınırı geçerli olur; filigran ve bütçe freni uygulanmaz.
  - Firma havuzundan harcar, kullanıcının günlük ücretsiz hakkından ve kredisinden harcamaz.
- Harcama kontrolü firma satırı kilitlenerek yapılır (AZ-01, BUS-01):
  - üyelik yoksa 404;
  - askıdaki firmada 403 `org_suspended`;
  - üyenin aylık sınırı dolduysa 402 `member_cap_reached`;
  - havuz yetmezse 402 `org_insufficient_credits`.
- Başarısız ya da eksik sonuçta iade havuza döner (`refund`) ve aylık sınır da geri açılır.
- Görünürlük:
  - `GET /designs` yalnız kişisel tasarımları listeler. `GET /designs?orgId=` kişinin o firmadaki tasarımlarını
    listeler, üyelik gerekir.
  - Firma tasarımına (`GET /designs/:id`, analiz, silme vb.) yalnız hâlâ üye olan erişir. Çıkarılan kişiye 404.
- `GET /me/orgs`: firmalarım. Rol, aylık sınır, bu ayki kullanım ve kalan döner; havuz kredisi yalnız `OWNER` ve
  `ADMIN` için.

| Yöntem | Yol | Rol | Not |
|---|---|---|---|
| GET | `/me/orgs` | kullanıcı | Firmalarım |
| POST | `/orgs/invites/lookup` | herkes | `{ token }` → `{ orgName, role, email (maskeli), status, expiresAt }`; IP başına saatte 30 |
| POST | `/orgs/invites/accept` | kullanıcı | `{ token }` → `{ orgId, orgName, role, already }`; saatte 20 |
| POST | `/admin/orgs/:id/invites` | ADMIN | `{ email, role, monthlyCap?, reason }` → 201 firma ayrıntısı |
| POST | `/admin/orgs/:id/invites/:inviteId/revoke` | ADMIN | `{ reason }` |

Not: üye hesabını silerse firma alanındaki tasarımları da silinir (KVKK, hesap verisi). Firmanın kalıcı arşivi
istenirse 4. adımda projelerle ele alınacak.

Mobil (sonra): stüdyoda "Kişisel / Firma" seçimi, `orgId` ile üretim, `GET /me/orgs` ile kalan hak.

#### 7.23.3 Firmanın kendi ekibi ve web çalışma alanı (3. adım)

**Yetki** (son karar sunucuda; üye olmayana 404, yetkisiz üyeye 403 `org_forbidden`)

| İşlem | Sahip | Yönetici | Üye |
|---|---|---|---|
| Ekibi görmek | e-postalar, kullanım, davetler, havuz | aynı | yalnız ad + rol ve kendi hakkı |
| Davet | yönetici ya da üye | yalnız üye | — |
| Davet geri alma | ✓ | ✓ | — |
| Rol değiştirme, sahiplik devri | ✓ (kendi dışında) | — | — |
| Aylık sınır | herkes (kendi dışında) | yalnız üyeler | — |
| Çıkarma | yönetici ya da üye | yalnız üye | — |
| Ayrılma | önce devretmeli (409) | ✓ | ✓ |

Kimse kendi satırını bu uçlardan değiştiremez (409 `cannot_change_self` / `use_leave`). Davet gönderme kullanıcı
başına saatte 30. Her işlem kullanıcı adına denetlenir: `org.team_invite`, `org.team_invite_revoke`,
`org.team_member_update`, `org.team_owner_transfer`, `org.team_member_remove`, `org.leave`.

| Yöntem | Yol | Not |
|---|---|---|
| GET | `/orgs/:orgId` | Ekip sayfası (role göre alanlar) |
| POST | `/orgs/:orgId/invites` | `{ email, role?, monthlyCap? }` → 201 ekip |
| POST | `/orgs/:orgId/invites/:inviteId/revoke` | → 201 ekip |
| PATCH | `/orgs/:orgId/members/:userId` | `{ role?, monthlyCap? }`; `role: OWNER` sahipliği devreder |
| POST | `/orgs/:orgId/members/:userId/remove` | → 201 ekip |
| POST | `/orgs/:orgId/leave` | → 204 |

**Web**
- Üst menüde çalışma alanı seçici ("Kişisel" / firma adları). Yalnız firma üyelerine görünür; askıdaki firma
  seçilemez. Seçim tarayıcıda hatırlanır (`localStorage`), firmadan çıkınca kişisele döner.
- Firma alanında:
  - kredi göstergesi "Firma · N hak" gösterir ve ekip sayfasına gider;
  - stüdyo `orgId` ile üretir ve "tasarımlar firma kredisinden harcar" notunu gösterir;
  - "Tasarımlarım" o firmadaki tasarımları listeler.
- `/ekip` sayfası (11 dil, arama motorlarına kapalı): firma seçimi, rol ve kalan hak, havuz (yöneticilere), üyeler
  (rol, sahiplik devri, sınır, çıkarma), davet formu, bekleyen davetler, firmadan ayrılma.

#### 7.23.4 Projeler (4. adım)
Firma içinde ortak klasör; örneğin bir müşterinin dairesi.

**Görünürlük**
- Projeye konan tasarımı firmanın tüm üyeleri görür.
- Firma alanındaki projesiz tasarımlar yalnız yapanındır.
- Ekip arkadaşının tasarımı salt okunur (`mine: false`): görüntüleme ve indirme açık; favori, silme, analiz,
  sohbet ve "bu sonuçla devam et" yalnız yapan kişide.
- Firmadan çıkan kişi firma tasarımlarına erişemez. Projedeki tasarımları firmada kalır, ekip görmeye devam eder.
  Kişi hesabını silerse tasarımları da silinir (KVKK).

**Yönetim**
- Her üye proje açabilir.
- Adı, müşteriyi ve notu değiştirmek, arşivlemek: açan kişi ya da sahip/yönetici. Aksi hâlde 403 `org_forbidden`.
- Yalnız boş proje silinir; içinde tasarım varsa 409 `project_not_empty`, arşivlenir.
- Arşivdeki projeye yeni tasarım konmaz (409 `project_archived`).
- Firmada en çok 500 etkin proje olabilir.

**Ayrım (AZ-02, AZ-04)**
- Başka firmanın proje kimliği hiçbir uçta çözülmez (404).
- Veritabanında tasarımın `(projectId, orgId)` çifti bileşik yabancı anahtarla projenin `(id, orgId)` çiftine
  bağlıdır; bir tasarım yalnız kendi firmasının projesinde durabilir.
- CHECK kısıtı projesi olan tasarımın firmasız olmasını engeller.
- Proje silinirken tasarım varsa veritabanı da reddeder (`ON DELETE RESTRICT`).

**Tasarımlar**
- `POST /designs` → `{ orgId, projectId }`: doğrudan projede üretir. Proje kontrolü ücretten önce yapılır; geçersiz
  projede havuzdan bir şey düşmez.
- `PATCH /designs/:id` → `{ projectId: <id> | null }`: yalnız tasarımı yapan kişi, firma tasarımını kendi firmasının
  açık projesine taşır ya da projeden çıkarır. Kişisel tasarımda 409 `personal_design`.
- `GET /designs?orgId=&projectId=`: projedeki herkesin tasarımları.
- `GET /designs/:id`: kendi tasarımı ya da üyesi olduğu firmanın projesindeki tasarım. Yanıtta `mine` var.

| Yöntem | Yol | Not |
|---|---|---|
| GET | `/orgs/:orgId/projects?status=ACTIVE\|ARCHIVED` | Tasarım sayısı ve kapak görseliyle (en çok 200) |
| POST | `/orgs/:orgId/projects` | `{ name, clientName?, note? }` → 201 |
| PATCH | `/orgs/:orgId/projects/:projectId` | `{ name?, clientName?, note?, status? }` |
| POST | `/orgs/:orgId/projects/:projectId/delete` | → 204; boş değilse 409 |

Denetim kaydı: `org.project_create`, `org.project_update`, `org.project_delete`.

**Web**
- Tasarımlarım (firma alanında): "Benim tasarımlarım" ve proje şeridi; proje seçilince ekibin tasarımları
  listelenir. "Yeni proje" formu var. Kendi kartında "Projeye taşı" seçimi, ekip arkadaşının kartında "Ekipten"
  etiketi gösterilir.
- Stüdyoda "Proje" seçimi.
- Sonuç görünümü başkasının tasarımında salt okunurdur.

**Admin:** firma ayrıntısında projeler listesi (salt okunur).

Sonraki adım:
- **5. adım:** logolu sunum, alan adıyla katılım, kartla ödeme, SSO.

### 7.24 Kredi hareketlerim — backend + web (mobil sonra)
Kullanıcı kendi kredi defterini görür: neye harcadığını, ne iade edildiğini, ne kazandığını. Kaynak YediOda #57
("Jeton hareketlerim").

`GET /me/credits?limit=20&cursor=<id>` → `{ items: [{ id, delta, kind, designId, productId, createdAt }], nextCursor }`
- En yenisi üstte gelir. `limit` 1–50 arasıdır, varsayılan 20. Sayfalama `cursor` ile yapılır. Oturum gerekir;
  yalnız kendi satırları döner.
- `kind` değerleri:
  - `daily_free`: günlük ücretsiz hakla tasarım (kredi düşmez);
  - `generation`: krediyle tasarım;
  - `refund`: başarısız tasarımın iadesi;
  - `welcome`: hoş geldin hediyesi;
  - `purchase`: kredi paketi;
  - `adjustment`: destek ekibinin düzeltmesi;
  - `other`: diğer.
- `designId` yalnız tasarım hareketlerinde gelir. Web "Tasarıma git" bağlantısı gösterir.
- `productId` yalnız satın almada gelir (mağaza ürün kimliği).
- Gizlilik (AZ-03): yönetici düzeltmesinin serbest metin gerekçesi, personelin kimliği ve mağaza işlem kimliği
  hiçbir zaman dönmez. Bunlar yalnız admin'deki kullanıcı ayrıntısında görünür.
- Firma çalışma alanındaki tasarımlar firmanın havuzundan düşer; bu listede değil, firmanın defterinde görünür
  (§7.23).

Web: **Hesabım → Kredi hareketlerim** bölümü 11 dildedir. "Daha fazla göster" düğmesi vardır; ücretsiz hak
kullanımı "ücretsiz" diye ayrıca işaretlenir, böylece kredi düşmüş gibi görünmez.

Mobil (sonra): Profil → Kredi hareketlerim ekranı aynı ucu kullanır.

### 7.25 Ürün kataloğu panelden: araçlar, odalar, zeminler, renkler — backend + admin (web ve mobil hazır)
Uygulamanın sunduğu araçlar, oda tipleri, zeminler ve duvar renkleri artık kodda değil, panelde yönetilir
(**Admin → İçerik → Ürün kataloğu**). Kod bir aracın ne yaptığını söyler (istediği girdiler ve istemi); panel şunları
söyler: araç sunuluyor mu, PRO'ya mı özel, "Yeni" rozeti var mı, adı ne, sırası ne. Panel ayrıca uygulamanın
sunduğu odaları, zeminleri ve renkleri, istem metinleriyle birlikte belirler. Kimse kaydetmediyse kodun kataloğu
geçerlidir; davranış değişmez.

Ayarın deposu: `Setting` tablosunda `product.catalog` satırı. Her API ve iş süreci bellekte tutar, 15 saniyede bir
yeniler; kayıtta hemen geçer.

**Uygulama tarafı (web ve mobilde kod değişikliği gerekmez)**
- `GET /catalog` → `tools`, `rooms`, `floors`, `colors` yalnız açık olanları, paneldeki sırayla döner. Alanlar
  aynıdır: `id`, `name`, `description`, `icon`, `category`, `isPro`, `isNew`, `needs`.
- Kapatılmış araçla gelen istek (eski uygulama hâlâ gösteriyorsa): `POST /designs` → 400 `tool_unavailable`
  "Bu araç şu an kullanılamıyor". Kapalı ya da kaldırılmış oda veya zemin → 400 `validation_failed`.
- `roomId` / `floorId` artık biçimle (`^[a-z][a-z0-9_]{1,39}$`) doğrulanır; sunulup sunulmadığı oluşturma anında
  katalogdan bakılır.
- Diller: Türkçe ve İngilizce ad panelden gelir. Diğer 9 dil, İngilizce ad kodunkiyle aynıyken çeviri dosyasını
  kullanır. Ad değiştirildiyse ya da kayıt panelde eklendiyse İngilizce ad gösterilir (eski çeviri yanlış kalmasın).
- Asistan sohbeti ve pazarlama AI'ı (mağaza metni, sosyal medya, kampanya) yalnız sunulan araç ve odaları anar.

**Geçmiş bozulmaz**
- Listeden çıkarılan oda ve zemin `retired` listesine geçer. Eski tasarımların başlığında adıyla görünür; kuyruktaki
  iş istemini almaya devam eder. Aynı kimlik geri eklenirse listeden çıkar.
- Kapatılan (silinmeyen) oda yeni tasarımda seçilemez, eski tasarımlarda adıyla görünür.

**Doğrulama (INP-01)**
- İstem metni İngilizce harf, rakam, boşluk ve `, ' ( ) / & . -` içerebilir. Oda için en çok 60, zemin için en çok
  80 karakterdir. Tırnak, köşeli ve süslü parantez, `<>` kabul edilmez: metin görsel modeline sabit İngilizce
  şablonun içinde gider.
- Oda simgesi sabit listeden seçilir (`roomIcons`, mobilin Ionicons adları).
- Kimlikler benzersizdir. Renk `#RRGGBB` biçimindedir ve büyük harfe çevrilir.
- Araç listesi kodun 10 aracının her birini bir kez içerir: araç eklenemez, yalnız açılıp kapatılır. En az bir
  araç açık olmalıdır. Oda isteyen bir araç açıkken en az bir oda, Yeni Zemin açıkken en az bir zemin açık olmalıdır.
- Bozuk bir satır uygulamayı durdurmaz: kodun kataloğu kullanılır, hata loglanır. Kodda sonradan eklenen bir araç,
  kayıtlı kataloğun sonuna kodun tanımıyla eklenir.

**Admin uçları**
| Yöntem | Yol | Rol | Açıklama |
|---|---|---|---|
| GET | `/admin/product` | SUPPORT | `{ catalog: { tools, rooms, floors, colors }, defaults, usage: { rooms, floors }, retired, toolInfo, roomIcons, saved, version, updatedAt, updatedBy }`. `usage`: kimlik başına tasarım sayısı; `toolInfo`: aracın kategorisi ve istediği girdiler (kodda) |
| PATCH | `/admin/product` | ADMIN | `{ catalog, reason, version }` → aynı yanıt. `version` okunan değerdir (hiç kaydedilmediyse null); arada değiştiyse 409 `version_conflict` (BUS-02) |

Denetim kaydı: `product.catalog_update`. Gerekçe ve değişiklik listesi tutulur, örneğin
`tools.garden.enabled: true → false`, `rooms+ loft`, `rooms- office`, `colors: sıra değişti`.

Sonraki adımlar ("her şey panelden"): araç başı istem şablonları (sürümlü, geri alınabilir), AI sağlayıcı ve
model seçimi, özellik bayrakları (`GET /features`), araç başı kredi bedeli.

#### 7.25.1 Araç başı hak bedeli
Her aracın görsel başına bir hak bedeli vardır (Ürün kataloğu → Araçlar → "Hak bedeli"). Bedel 1–10 arasıdır,
varsayılanı 1'dir; panelden değiştirilmedikçe davranış aynı kalır.

- Bir tasarımın düştüğü hak `seçenek sayısı × bedel` olur. Örneğin dış cephe bedeli 2 ise 2 seçenek 4 hak düşer.
  Günlük ücretsiz hak da aynı birimle sayılır: önce ücretsiz, sonra kredi. Firma çalışma alanında havuzdan düşer.
- Bedel tasarım oluşturulurken `params.unitCost` alanına yazılır. Panelde sonradan değişse de o tasarımın tahsili
  ve iadesi değişmez.
- Gelmeyen seçenek kendi bedelini geri verir, önce krediye. Bedel alanından önce oluşturulmuş tasarımlar 1 sayılır.
- `GET /catalog` → `tools[].credits`. Web stüdyosu "Bu işlem N hak kullanır" satırında `seçenek × bedel`
  gösterir. Mobil aynı alanı okur (sonra).
- Bedel alanı olmadan kaydedilmiş bir katalog her araç için 1 kabul edilir.

### 7.26 İstem şablonları panelden — AI servisi + backend + admin
Görsel modeline giden istem, araç başına admin'den yönetilir (**Admin → Yapay zekâ → İstem şablonları**; YediOda #30,
fal-app prompt-resolver). Yeni sürüm yayınlanır, örnek değerlerle önizlenir; gerekirse eski bir sürüme ya da koddaki
varsayılana tek adımda dönülür. Hiçbir şey yayınlanmadıysa davranış değişmez.

**Şablonlar ve alanlar (AI servisi tanımlar)**
- 12 anahtar var:
  - `keep`: ortak "odayı koru" cümlesi; diğer şablonlarda `{keep}` yazan yere girer;
  - araç başına: `redesign`, `furnish`, `declutter`, `declutter_all` ("hepsini sil"), `replace`, `paint`,
    `flooring`, `exterior`, `garden`, `reference`, `custom`.
- Alanlar: `{room}`, `{style}`, `{keep}`, `{extra}`, `{what}`, `{thing}`, `{replacement}`, `{walls}`, `{color}`,
  `{floor}`, `{reference}`, `{request}`.
- Her anahtar yalnız kendi alanlarını kullanabilir; zorunlu olanlar şablonda bulunmalıdır. Örneğin `replace` için
  `{thing}` ve `{replacement}`; ek açıklama alan araçlarda `{extra}`. Böylece kullanıcının seçimi ya da isteği sessizce
  düşmez.
- Varsayılan şablonlar eski istemlerin aynısını üretir. `tests/test_prompts.py`, 320 girdi kombinasyonunda eski
  kodla (`tests/fixtures/prompts_v1.py`) harfi harfine karşılaştırır.

**Güvenlik (INP-01, AZ-01, BUS-02, LOG-01)**
- Değerleri kod üretir. Kullanıcı metni önceki gibi temizlenir (tırnak, `<>`, `{}`, kontrol karakteri atılır) ve
  tırnak içinde verilir. Şablon yalnız yerini belirler.
- Yerleştirme tek geçişlidir: değerin içindeki `{...}` yeniden taranmaz.
- Kurallar:
  - uzunluk 10–1500 karakter (`keep` için en çok 600);
  - süslü parantez yalnız `{alan}` biçiminde kullanılabilir;
  - bilinmeyen alan reddedilir;
  - kontrol karakterine izin verilmez.
- Yayın, AI servisinin doğrulamasından geçmeden olmaz. Servise ulaşılamazsa yayın yapılmaz (fail-closed).
- Kayıtlı bir şablon sonradan geçersiz kalırsa (ör. bir alanın adı değişirse) üretim durmaz; o anahtar için varsayılan
  kullanılır.
- Yalnız ADMIN ve üstü görür ve değiştirir; destek ekibi istemleri ne görür ne değiştirir.
- Yayın ve geri dönüş not ister, `prompt.publish` / `prompt.activate` olarak denetlenir.
- Eşzamanlı değişiklik 409 `version_conflict` alır.

**Saklama**
- `PromptVersion` tablosu yalnız ekleme yapar (anahtar, metin, not, yazan, zaman).
- Hangi sürümün yayında olduğu `Setting` tablosunda `ai.prompts` satırında tutulur (anahtar → sürüm kimliği).
- Bellekte tutulur, 15 saniyede bir yenilenir; değişiklikte hemen geçer.
- Her üretimde yalnız o aracın şablonları ve `keep` gönderilir (`prompt_templates`).
- Kullanılan sürümler tasarımın `params.promptVersions` alanına yazılır; sonuç kalitesini sürüme göre ölçmek için.

**AI servisi (iç)**
- `GET /internal/v1/prompts` → `{ templates: [{ key, tool, default, placeholders, required }], placeholders }`
- `POST /internal/v1/prompts/preview` `{ key, template, keep? }` → `{ prompt | null, errors }`. Görsel üretmez,
  ücret yok. Hata kodları: `length`, `control_chars`, `stray_brace`, `unknown_placeholder:<ad>`,
  `missing_placeholder:<ad>`, `unknown_key`.
- `POST /internal/v1/generate` isteğine `prompt_templates` eklendi (en çok 16 anahtar, her biri en çok 1500
  karakter).

**Admin uçları (rol ADMIN)**
| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/admin/prompts` | `{ templates: [{ key, tool, default, placeholders, required, activeVersionId, text, versions[≤20] }], placeholders }`; AI servisi kapalıysa 502 |
| POST | `/admin/prompts/preview` | `{ key, text }` → `{ prompt, errors }` |
| POST | `/admin/prompts/:key/publish` | `{ text, note, expected }` → liste. Hatalar: geçersizse 400 `invalid_template` (Türkçe neden); aynı metin yayındaysa 400 `no_change`; bilinmeyen anahtar 404; `expected` uymazsa 409 |
| POST | `/admin/prompts/:key/activate` | `{ versionId \| null, reason, expected }` → liste. `null` varsayılana döner; başka anahtarın sürümü 404; metin yeniden doğrulanır |

**Admin ekranı**
- Solda 12 şablon listelenir; panelden değişenler noktayla işaretlidir.
- Düzenleyicide alan düğmeleri var: tıklayınca imleç yerine eklenir, zorunlular `*` ile işaretli.
- Canlı önizleme örnek değerlerle gösterilir. Hata Türkçe olarak yazılır.
- "Varsayılanı yükle", not ile "Yayınla" ve sürüm geçmişi var. Geçmişte "Düzenleyiciye yükle", "Bu sürüme dön" ve
  "Varsayılana dön" bulunur.

### 7.27 Model ve sağlayıcı panelden — AI servisi + backend + admin
Görsel üretiminde hangi sağlayıcının hangi sırayla ve hangi modelle deneneceği admin'den seçilir
(**Admin → Yapay zekâ → Model ve sağlayıcı**; YediOda #27, palemi model manifesti). Birincil sağlayıcı hata verirse
ya da devre kesicisi açıksa sıradaki denenir. Kimse kaydetmediyse sunucunun zinciri kullanılır
(`IMAGE_PROVIDER` + `IMAGE_FALLBACKS`); davranış değişmez.

**Neyin seçilebileceğine sunucu karar verir**
- Sağlayıcı ancak anahtarı sunucuda tanımlıysa seçilebilir. Anahtarı `deploy/hazal/set-secret.sh` ile sahibi ekler.
  Demo sağlayıcı (`mock`) üretimde seçilemez.
- Model, sağlayıcının sunucuda ayarlı modeli ya da `IMAGE_MODEL_ALLOWLIST` içindeki bir kayıt olmalıdır.
  - Kayıt biçimi: `sağlayıcı|model|görsel_başı_usd|etiket;…`.
  - Bir model listeye yalnız lisansı ve fiyatı kontrol edildikten sonra eklenir.
  - Panelden serbest model adı yazılamaz; bu, maliyet ve lisans güvencesidir.
  - Biçimi bozuk kayıt servisi açılışta durdurur (KEY-02).
- Maliyet defteri artık modele göre hesaplanır: listedeki kaydın fiyatı, yoksa sağlayıcının fiyatı.

**Kayıt ve kullanım**
- Seçim `Setting` tablosunda `ai.engine` satırında durur: `{ chain: string[1..4], models: {sağlayıcı: model} }`.
  Bellekte tutulur, 15 saniyede bir yenilenir ve her üretimle `engine` olarak AI servisine gider.
- Kayıt anında AI servisinin listesine göre doğrulanır. Servise ulaşılamazsa kayıt yapılmaz (fail-closed).
- Sonradan uygulanamaz hâle gelen seçim üretimi durdurmaz; AI servisi o istekte kendi zincirini kullanır. Örnekler:
  anahtar kaldırıldıysa ya da model listeden çıktıysa. Panel bunu `ignored` listesiyle kırmızı uyarı olarak gösterir.
- Devre kesici sağlayıcı adına göre tektir; aynı sağlayıcının bütün modelleri ve bütün zincirler onu paylaşır.

**AI servisi (iç)**
- `GET /internal/v1/engines` → `{ providers: [{ name, configured, usable, default_model, models: [{ id, label,
  cost_usd }] }], default_chain, breakers }`
- `POST /internal/v1/generate` isteğine `engine: { chain, models }` eklendi. Uygulanamayan seçimde sunucu zinciri
  kullanılır ve loga `engine_choice_ignored` yazılır.

**Admin uçları (rol ADMIN; destek ekibi göremez, AZ-01)**
| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/admin/ai-engine` | `{ choice, ignored, catalog, version, updatedAt, updatedBy }`; AI servisi kapalıysa 502 |
| PATCH | `/admin/ai-engine` | `{ engine \| null, reason, version }`. `null` sunucu varsayılanına döner. Uygunsuz seçim 400 `invalid_engine` (Türkçe neden); `version` uymazsa 409 |

Denetim kaydı: `ai.engine_update` (gerekçe, önceki ve yeni seçim).

**Admin ekranı**
- Zincir sıralanır: birincil ve yedekler, yukarı/aşağı taşıma, çıkarma, "+ sağlayıcı" ile ekleme.
- Her satırda izinli modellerden seçim yapılır; görsel başı yaklaşık maliyet ve devre durumu (Çalışıyor / Devre açık /
  Deneniyor) görünür.
- Seçilemeyen sağlayıcıların nedeni yazılır.
- Birincil sağlayıcı değişirken onay istenir. "Sunucu varsayılanına dön" düğmesi vardır.

### 7.28 Özellik bayrakları — backend + admin + web (mobil okur)
Bir özellik kod değişikliği olmadan admin'den kapatılıp açılır (**Admin → Sistem → Özellikler**; Palemi feature
flags). Liste kodda sabittir: her bayrak kodun gerçekten kapatabildiği bir özelliği kapatır. Hepsi açık başlar;
biri kapatılmadıkça hiçbir şey değişmez.

| Bayrak | Kapalıyken |
|---|---|
| `assistant_chat` | `POST /chat` → 403. Web'de AI Sohbet bağlantısı gizlenir, sayfa "kapalı" der |
| `cost_analysis` | Yeni `POST /designs/:id/analysis` → 403. Önceden yapılmış analiz yine döner |
| `tap_selection` | `POST /uploads/:id/selection` ve `points` içeren `POST /designs` → 403. Stüdyoda dokunarak seçim gizlenir; nesne adı yazılarak seçilir |
| `support_tickets` | Yeni `POST /me/support` → 403. Açık talepler okunur ve yanıtlanır. Web'de yeni talep formunun yerinde "kapalı" yazar |
| `guest_mode` | Yeni misafir hesabı açılmaz (`POST /auth/guest` → 403); mevcut misafir cihazı girer. Girişte "Misafir olarak dene" gizlenir |
| `signup` | `POST /auth/register` ve Apple/Google ile yeni hesap ya da misafirin kayda dönmesi → 403; var olan hesaplar girer. Girişte "Kayıt ol" gizlenir |
| `blog` | `GET /blog` ve `GET /blog/:slug` → 404; site haritası yazı listelemez. Web'de blog bağlantısı gizlenir |

Reddetme biçimi: 403 `feature_disabled` "<özellik> şu an kapalı.", `details.feature` ile. Eski bir uygulama özelliği
hâlâ gösterse bile sunucu reddeder.

**Okuma**
- `GET /features` → `{ features: { anahtar: boolean } }`. Herkese açıktır, 30 saniye önbelleklenir.
- Aynı nesne `GET /catalog` içinde `features` olarak da gelir.
- İstemci kuralı: okunamayan ya da eksik bayrak **kapalı** sayılır. Web, katalog yüklenirken mevcut görünümü korur,
  katalog okunamazsa kapalı sayar.

**Saklama**
- `Setting` tablosunda `features` satırında durur. Bellekte tutulur, 15 saniyede bir yenilenir; kayıtta hemen geçer.
- Sonradan eklenen bir bayrak varsayılan değeriyle (açık) gelir.
- Bozuk satır varsayılanlara döner ve loglanır.

**Admin uçları**
| Yöntem | Yol | Rol | Açıklama |
|---|---|---|---|
| GET | `/admin/features` | SUPPORT | `{ features: [{ key, label, description, where, enabled }], version, updatedAt, updatedBy }` |
| PATCH | `/admin/features` | ADMIN | `{ features: { …7 bayrağın hepsi }, reason, version }`. Bilinmeyen ya da eksik bayrak 400; `version` uymazsa 409 (BUS-02) |

Denetim kaydı: `features.update`, gerekçe ve `assistant_chat: açık → kapalı` gibi değişiklik listesiyle.

Mobil (sonra): açılışta katalogdaki `features` okunur; kapalı özelliklerin girişi gizlenir.

### 7.29 Promosyon ve hediye kodları — backend + admin + web (mobil sonra)
Kod kredi ya da PRO günü verir (**Admin → Büyüme → Promosyon kodları**; YediOda #64, maeyja coupons, fal-app promo).

**İki tür**
- **Kampanya kodu:** admin yazar (ör. `YAZ2026`, 6–32 harf ve rakam). Çok kişi kullanır, kişi başı bir kez.
  İsteğe bağlı toplam kullanım sınırı vardır.
- **Hediye kodları:** toplu üretilir (1–1000 adet, `XXXX-XXXX-XXXX`), her biri tek kullanımlıktır. Alfabede 0/O,
  1/I/L ve U yoktur; 30¹² olasılık. Kodlar **yalnız üretim yanıtında** görünür, admin ekranı CSV indirir. Sistemde
  okunur hâlde saklanmaz; listede `ABCD…WXYZ` biçiminde görünür.
- Ortak alanlar:
  - kampanya adı;
  - verdiği şey: `CREDITS` (1–500) ya da `PRO_DAYS` (1–365);
  - isteğe bağlı başlangıç ve bitiş;
  - "yalnız yeni üyeler": kod oluşturulduktan sonra açılan hesaplar.

**Kullanma: `POST /me/promo { code }` → `{ kind, amount, proUntil }`**
- Büyük-küçük harf, boşluk ve tire fark etmez.
- Yalnız kayıtlı ve e-postası doğrulanmış hesap kullanabilir; misafir ya da doğrulanmamış hesap 403
  `verification_required` alır.
- Geçersiz, süresi dolmuş, başlamamış, durdurulmuş, tükenmiş ya da yeni üyelere özel kodların hepsi tek yanıt alır:
  404 `invalid_code` "Kod geçersiz ya da artık kullanılamıyor." Böylece kod tahmin etmeye yarayan bir ipucu
  verilmez.
- Aynı kişi aynı kodu bir kez kullanır → 409 `already_redeemed`.
  - Kişi = hesap **ve** e-posta kimliği. Kimlik, hoş geldin kredisindeki normalleştirmeyle anahtarlı özet olarak
    tutulur; Gmail noktaları ve `+etiket` aynı kişi sayılır.
  - Hesap silinince kullanım kaydı kalır (`userId` boşalır); yeniden açılan hesap aynı kodu bir daha kullanamaz.
- Süresiz PRO hesap PRO günü veren kodu kullanamaz: 409 `already_pro`. PRO günleri paneldeki PRO'nun üstüne
  eklenir; mağaza aboneliği ayrıca sürer.
- Hız sınırı (RES-01): hesap başına saatte 10, IP başına saatte 30 deneme. Başarısız denemeler de sayılır.
- Tek işlem (BUS-02):
  1. kod satırı `FOR UPDATE` ile kilitlenir;
  2. uygunluk ve daha önce kullanım kontrol edilir;
  3. kullanım kaydı yazılır (benzersiz: kod+hesap, kod+kimlik);
  4. kredi ya da PRO verilir, sayaç artar.
- Veritabanı kısıtı `0 ≤ redeemed ≤ maxRedemptions` sınırı ayrıca korur.
- Defter: kredi `promo`, PRO günü `promo_pro` (delta 0) olarak yazılır. Kredi hareketlerim'de `kind: promo`
  ("Promosyon kodu") görünür.

**Admin uçları** (okuma SUPPORT, değiştirme ADMIN; hepsi denetlenir: `promo.create`, `promo.batch`, `promo.update`)
| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/admin/promo?campaign=&q=&cursor=` | Kodlar ve kampanya özetleri (kod sayısı, kullanım). `q` kampanya adında ya da tam kodla arar |
| POST | `/admin/promo` | Kampanya kodu `{ code, campaign, kind, amount, maxRedemptions?, startsAt?, endsAt?, newUsersOnly, reason }` → 201; aynı kod 409 `code_exists` |
| POST | `/admin/promo/batch` | Hediye kodları `{ campaign, kind, amount, count, startsAt?, endsAt?, newUsersOnly, reason }` → 201 `{ codes: [...] }` (bir kez) |
| PATCH | `/admin/promo/:id` | `{ active?, endsAt?, maxRedemptions?, reason }`; sınır şimdiye kadarki kullanımın altına inemez |
| GET | `/admin/promo/:id/redemptions` | Kim, ne zaman (en çok 200; silinmiş hesap "silinmiş hesap" görünür) |

**Web:** Hesabım → "Promosyon kodu" kutusu (11 dil). Başarıda "{n} kredi hesabına eklendi" ya da "PRO {tarih}
tarihine kadar açık" yazar. Misafire ve doğrulanmamış hesaba neden kullanamadığı söylenir.

Gizlilik metnine eklenecek cümle (sahibinin işi, hoş geldin kredisiyle aynı): kötüye kullanımı önlemek için e-posta
kimliğinin geri döndürülemez özeti, kod durdukça saklanır.

### 7.30 Davet et-kazan — backend + admin + web (mobil sonra)
Kullanıcı arkadaşını kendi bağlantısıyla davet eder (**Admin → Büyüme → Davet programı**; YediOda #65, fal-app
referral). Program **kapalı başlar**; admin açar.

**Ödül kuralı (BUS-01: sahte kayıt kazandırmaz)**
- Davet edilen, kodu girince `inviteeCredits` alır. Koşullar:
  - hesap kayıtlı ve e-postası doğrulanmış olmalı;
  - kayıttan sonraki `claimDays` gün içinde girilmeli;
  - kişi başı bir kez.
- Davet eden, arkadaşının **ilk başarılı tasarımında** `inviterCredits` alır, bir kez.
  - Aylık sınır (`monthlyCap`, İstanbul ayı) dolmuşsa davet `REJECTED` olur: "Aylık davet ödülü sınırı doldu".
  - Uygulamada push bildirimi gider ("Davet ödülü").
- Bir e-posta kimliği yalnız bir kez davet edilmiş sayılır (anahtarlı özet; Gmail noktaları ve `+etiket` aynı kişi).
  Kayıt hesap silinince de kalır.
- Kendi kodu, kendi posta kutusunun başka bir hesabı da dahil, kullanılamaz: 400 `own_code`. Veritabanında
  `inviterId <> inviteeId` kısıtı da var.
- Ödül, `PENDING → REWARDED` koşullu güncellemesiyle verilir. İki tasarım aynı anda bitse de tek ödül çıkar
  (BUS-02).
- Şüpheli bekleyen davet admin'den reddedilir; davet eden ödül almaz, davet edilenin kredisi kalır.

**Kullanıcı uçları**
- `GET /me/referral` → `{ enabled, code, link, inviterCredits, inviteeCredits, stats: { invited, rewarded, earned },
  canClaim, claimed }`.
  - Kod, doğrulanmış hesaba ilk istekte üretilir: 8 karakter, karışabilen harfler yok.
  - Bağlantı: `<WEB_APP_URL>/giris?ref=KOD`.
- `POST /me/referral/claim { code }` → `{ credits }`. Hatalar:
  - 403 `verification_required`;
  - 409 `claim_closed` ya da `already_claimed`;
  - 400 `own_code`;
  - 404 `invalid_code` (program kapalıysa da 404).
  - Hız sınırı promosyon koduyla ortaktır: hesap başına saatte 10, IP başına saatte 30.
- Defter: `referral_invitee` ve `referral_inviter` → Kredi hareketlerim'de `kind: referral` ("Davet ödülü").

**Admin uçları** (okuma SUPPORT, değiştirme ADMIN; denetim: `referral.settings`, `referral.reject`)
| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/admin/referrals?status=` | Ayarlar, son 30 gün (katılan, ödüllenen, dağıtılan kredi), bekleyen sayısı, en çok davet edenler, son 100 davet |
| PATCH | `/admin/referrals/settings` | `{ settings: { enabled, inviterCredits 1–50, inviteeCredits 0–50, monthlyCap 1–100, claimDays 1–60 }, reason, version }`; çakışma 409 |
| POST | `/admin/referrals/:id/reject` | `{ reason }`; yalnız bekleyen (`PENDING`), değilse 409 `not_pending` |

**Web**
- `/giris?ref=KOD` kodu bu cihazda 14 gün saklar. Kayıt ve e-posta doğrulaması başka sekmede yapılsa da kod kalır.
- Hesabım → "Arkadaşını davet et" (11 dil): bağlantı ve "Bağlantıyı kopyala", destekleyen tarayıcıda "Paylaş",
  sayılar.
- Yeni hesapta "Davet kodun var mı?" kutusu saklanan kodla dolu gelir.

Gizlilik metnine eklenecek cümle (sahibinin işi): davetin kötüye kullanımını önlemek için e-posta kimliğinin geri
döndürülemez özeti saklanır.

### 7.31 Panelden hediye kredi — backend + admin + web (mobil bildirim alır)
Admin kullanıcı ayrıntısında **"Hediye gönder"** ile kullanıcıya hediye kredi verir (YediOda #63 "manuel hediye").
Kredi düzeltmesinden farkı şudur:
- Düzeltme (`admin: …`) kullanıcıya yalnız "Destek ekibinden düzenleme" diye görünür ve bildirim gitmez.
- Hediye görünür olsun diye vardır: kullanıcı bildirim alır, Kredi hareketlerim'de "Hediye" (`kind: gift`) yazar.

`POST /admin/users/:id/gift { credits 1–500, message ≤140, email, reason }` → 201 `{ credits, pushed, emailed }`
- Rol ADMIN; yönetici hesabına yalnız SUPER_ADMIN gönderir (AZ-05). Askıdaki hesaba gönderilemez: 409.
- `message` kullanıcıya gösterilir: push metni ve e-postada. Boşsa varsayılan metin kullanılır ("Casalume ekibinden
  sana hediye kredi…").
- `reason` iç nottur; yalnız denetim kaydına (`user.gift`) yazılır.
- Push, kullanıcının dilinde (TR/EN) bütün cihazlarına gider: `data: { type: 'gift', path: '/hesap' }`.
- E-posta yalnız `email: true` ve doğrulanmış adres varsa gider.
- Defter satırı `reason: 'gift'` olarak yazılır. `refId` personeldir ve kullanıcıya hiç dönmez.

Admin kredi hareketleri tablosu yeni türleri okunur gösterir: Hediye, Promosyon kodu, Davet ödülü.

### 7.32 Toplu hediye (sadakat ve geri dönüş) — backend + admin
Bir gruba hediye kredi ve push bildirimi gönderilir (**Admin → Büyüme → Toplu hediye**; YediOda #63 dönüş hediyesi,
sadakat). Kullanıcı tarafında tekli hediyeyle (§7.31) aynı görünür: bildirim gider, Kredi hareketlerim'de "Hediye"
yazar.

**Gruplar** (hepsinde yalnız gerçek kullanıcılar var: `role = USER`, aktif, misafir değil, e-postası doğrulanmış;
personel ve misafir hiçbir zaman yoktur)
- `inactive` + `days`: en az N gündür girmemiş (`lastSeenAt`, hiç görülmediyse kayıt tarihi). Geri dönüş hediyesi.
- `new` + `days`: son N günde katılmış.
- `pro`: şu an PRO; panel ya da mağaza aboneliği. Teşekkür hediyesi.
- `all`: bütün doğrulanmış kullanıcılar.

**Gönderim**
- Önce önizleme yapılır: `POST /admin/gifts/preview { segment, days }` → `{ count, withPush, max }`. Rol SUPPORT
  ve üstü.
- Sonra gönderilir: `POST /admin/gifts { segment, days, credits 1–100, message ≤140, reason, expected }` → 201
  `{ id, recipients }`. Rol ADMIN ve üstü; denetimde `gift.campaign` olarak görünür.
- Bir seferde en çok 20.000 kişiye gönderilir. Boş grup 400 `empty_segment`, fazlası 400 `too_many` alır.
- `expected` önizlemedeki sayıdır. Grup bunun çok üstüne çıktıysa (%10 + 10) gönderim 409 `count_changed` ile
  durur.
- Aynı grup, gün ve kredi 10 dakika içinde ikinci kez gönderilemez (çift tıklama, ikinci admin): 409
  `duplicate_send`.
- Dağıtım 500 kişilik parçalarla yapılır. Her parça tek SQL ifadesidir:
  `GiftRecipient` (kampanya+kullanıcı birincil anahtarı, `ON CONFLICT DO NOTHING`) + `User.credits` + `CreditLedger`
  (`reason: 'gift'`, `refId` = kampanya). Yarıda kalsa ve yeniden çalışsa da kimse iki kez almaz (BUS-02).
  Kampanya `SENT` ya da `FAILED` olur.
- Bildirimler kredilerden sonra arka planda gider, kullanıcının dilinde (TR/EN). `message` boşsa varsayılan metin
  kullanılır ("Seni özledik! …"). Gönderilen bildirim sayısı kampanyaya yazılır.
- `GET /admin/gifts` son 50 kampanyayı döner: grup, kredi, alan kişi, bildirim, gönderen.

Smoke testi önizlemeyi her yerde dener; gerçek kişilere kredi verdiği için gönderimi yalnız yerel API'de dener.

Sonra: otomatik kurallar (giriş serisi, doğum günü, belirli gün girmeyene kendiliğinden hediye) ve e-posta kanalı.
Bunlar toplu gönderim (§7.16) kurallarıyla birlikte yapılacak: pazarlama izni, sessiz saat.

### 7.33 Ortak (influencer) bağlantıları — backend + admin + web (mobil sonra)
Influencer, mimar ya da mağaza için kısa bağlantı: `casalume.app/p/<ad>` (**Admin → Büyüme → Ortaklar**; YediOda #66).
Yalnız **ölçer**. Kitleye ödül verilecekse ortakla birlikte bir promosyon kodu tanımlanır (§7.29).

**Akış**
1. Ziyaretçi `/p/<ad>` adresini açar. Web ziyareti sayar (`POST /partners/:slug/visit`), ortağı bu cihazda 30 gün
   hatırlar (ilk dokunan kazanır) ve ana sayfaya yönlendirir. Sayfa arama motorlarına kapalıdır.
2. Bu cihazda bir hesap açılınca (misafir dahil) web bir kez `POST /me/attribution { via }` gönderir.
   - Sunucu yalnız şu durumda yazar: hesap 24 saatten yeni, rolü USER, ortak aktif.
   - Hesap başına tek ortak olur; ilk yazılan kalır.
   - Uymayan durumlar sessizce `attributed: false` alır.
3. Rapor bu kişilerin ne yaptığını sayar:
   - kayıt (misafir değil), doğrulanan, ilk başarılı tasarım;
   - ödeyen ve net gelir: RevenueCat USD, canlı ortam, iadeler düşülür; analizdeki gelirle aynı olay türleri;
   - tahmini komisyon: net gelir × oran. Ödeme sistem dışındadır.

**Uçlar**
| Yöntem | Yol | Rol | Açıklama |
|---|---|---|---|
| POST | `/partners/:slug/visit` | herkese açık | `{ counted }`. Bilinmeyen ya da durdurulmuş bağlantıda false. IP ve bağlantı başına saatte 20 (RES-01) |
| POST | `/me/attribution` | oturum | `{ via }` → `{ attributed }` (bir kez) |
| GET | `/admin/partners` | SUPPORT | Her ortak için: `link`, `visits`, `visits30`, `signups`, `verified`, `designers`, `payers`, `revenueUsd`, `commissionUsd` |
| POST | `/admin/partners` | ADMIN | `{ name, slug, commissionPct 0–50, note?, reason }` → 201 `{ id, slug, link }`. Bağlantı adı 3–40 küçük harf/rakam/tire; kullanılıyorsa 409 `slug_taken` |
| PATCH | `/admin/partners/:id` | ADMIN | `{ name?, commissionPct?, note?, active?, reason }` |

Denetim kaydında `partner.create` ve `partner.update` görünür.

Saklama: `Partner`, `PartnerVisitDay` (ortak ve İstanbul günü başına bir sayaç satırı) ve `PartnerAttribution`
(hesap başına bir satır; hesap silinince silinir). Ziyaretçiye ait kişisel veri tutulmaz.

### 7.34 Renk temaları — backend + admin + web (mobil sonra)
Kullanıcıların seçebildiği renk temaları panelden yönetilir (**Admin → Sistem → Renk temaları**).

**Palet nedir**
- Koyudan açığa 6 ton (ör. `#211713 … #F6EEDB`) ve web ile uygulamanın boyadığı 11 renk değişkeni:
  `primary`, `primaryStrong`, `primarySoft`, `accent`, `accentSoft`, `bg`, `surface`, `surface2`, `text`, `muted`, `border`.
- Yeni paletin değişkenlerini sunucu tonlardan üretir. Dört özgün tema (Kil, Pirinç, Mürekkep, Erik) elle ayarlı
  değişkenlerini korur.
- Hazır gelen 36 palet:
  - 4 özgün tema: Kil (varsayılan), Pirinç, Mürekkep, Erik;
  - 8 referans palet: Karamel Krem, Kakao Latte, Leylak Alacakaranlık, Kara Kiraz, Mürdüm Kadife, Orman Sisi, Derin
    Petrol, Gece Arduvazı;
  - sahibinin palet kütüphanesinden 24 palet (`~/Desktop/renk-paletlerim/palet-kutuphanesi`, aynı OKLCH formülü).
- Daha önce dağıtılmış paletlerin kısa adları değişmez, ziyaretçinin kayıtlı seçimi çalışmaya devam eder.
- Panelden kaydedilmiş bir listeye sonradan eklenen yerleşik paletler açık olarak eklenir. Panelden bilerek silinen
  palet geri gelmez: kayıt, bildiği yerleşik kısa adları `seen` alanında tutar.
- En çok 48 palet.

**Okunurluk (her kayıtta ölçülür)**
- Engelleyen kontroller, en az 4.5:1 (WCAG AA): metin, ikincil metin, beyaz buton yazısı, ana renkli yazı. Geçmeyen
  palet açılamaz; kapalı taslak olarak kaydedilebilir (400 `contrast_failed`).
- Uyarılar: vurgu (accent) rengi hem koyu yazının arkasında hem küçük renkli yazı olarak kullanıldığı için ölçülür
  ama kaydı engellemez.

**Güvenlik:** renkler web'de bir `<style>` öğesine yazılır. Bu yüzden yalnız `#rrggbb` renkler ve kısa ad olarak
`^[a-z][a-z0-9-]{1,23}$` kabul edilir. Web de aynı denetimi yeniden yapar (INP-01 / WEB-01).

**Uçlar**
| Yöntem | Yol | Rol | Açıklama |
|---|---|---|---|
| GET | `/theme` | herkese açık | `{ defaultId, palettes: [{ id, name: { tr, en }, tones[6], tokens }] }`. Yalnız açık paletler, varsayılan önce; 60 sn önbellek |
| GET | `/admin/theme` | SUPPORT | Tüm paletler: `enabled` ve okunurluk raporu (`contrast.blocking`, `contrast.warnings`), `builtinIds`, `version` |
| PATCH | `/admin/theme` | ADMIN | `{ theme: { defaultId, palettes }, reason, version }`. Hepsi birlikte kaydedilir. Varsayılan açık olmalı, kısa adlar tekil, en çok 24 palet. Eski sürüm 409 |
| POST | `/admin/theme/derive` | SUPPORT | `{ tones[6] }` → `{ tones, tokens, contrast }`. Önizleme; kaydetmez |

Denetim kaydında `theme.update` görünür; değişiklik listesi örneği: `varsayılan: kil → kahve`, `orman: kapandı`,
`eklendi: …`, `silindi: …`.

**Web:** temalar birkaç dakikalık önbellekle sunucuda okunur ve `<style>` olarak sayfaya yazılır, böylece doğru renk
ilk anda görünür. Ziyaretçinin seçimi tarayıcıda (localStorage) kalır. Panelden kapatılan bir tema seçilmişse
varsayılan görünür. API okunamazsa site yerleşik Kil temasında kalır ve tema menüsü gizlenir.

**Kapsam dışı:** panelin kendi renk seçeneği (Panel rengi) şimdilik dört sabit temadır.

**Mobil (uygulama):** aynı listeyi `GET /v1/theme` ile okur; ayrı bir palet kopyası tutulmaz. Panelde açılan ya da
kapatılan tema ve varsayılan uygulamaya da yansır.
- Açılışta okunur ve cihazda saklanır. Yanıt gelmezse saklanan liste, o da yoksa uygulamanın kendi Kil teması
  kullanılır.
- Kullanıcının seçimi cihazda `id` olarak tutulur. Seçilen `id` listede yoksa (panelden kapatılmışsa) `defaultId`
  kullanılır.
- Renkler `tokens` içindedir: `bg`, `surface`, `surface2`, `text`, `muted`, `border`, `primary` (beyaz yazılı buton),
  `primaryStrong` (basılı hâl), `primarySoft`, `accent`, `accentSoft`. Menüde `tones` (6 renk) şerit olarak gösterilir,
  ad `name.tr` ya da `name.en` olur.
- React Native örneği:
  ```ts
  const res = await fetch(`${API}/theme`);
  const { defaultId, palettes } = await res.json();
  const chosen = palettes.find((p) => p.id === saved) ?? palettes.find((p) => p.id === defaultId)!;
  const c = chosen.tokens; // <View style={{ backgroundColor: c.bg }}><Text style={{ color: c.text }}>…</Text></View>
  ```
- Koyu mod için ayrı renkler henüz yok; gerekirse sunucu aynı 6 tondan koyu değişkenleri de üretebilir.

### 7.35 Sadakat kuralları (kendiliğinden hediye) — backend + admin
Kendiliğinden verilen hediye krediler (**Admin → Büyüme → Sadakat kuralları**; YediOda #63). Üç kural da kapalı
başlar; her biri panelden açılır ve ayarlanır.

**Kurallar**
- **Giriş serisi** (`streak`): kullanıcı İstanbul takviminde üst üste N gün (3–60) etkin olunca kredi alır (1–20). Serinin
  her katında yeniden alır (7, 14, 21… gün); bir gün kaçarsa seri 1'den başlar.
  - Gün, o günün ilk oturumlu isteğinde sayılır (`UserGuard`).
  - Sayım tek bir SQL ile yapılır; aynı anda gelen istekler günü bir kez sayar.
  - Seri `User.streakDays` ve `User.streakDay` alanlarında tutulur.
- **Hesap yıldönümü** (`anniversary`): hesabın açıldığı günün her yıl dönümünde kredi (1–50). 29 Şubat hesapları artık
  yıl olmayan yıllarda 28 Şubat'ta alır. Doğum günü için doğum tarihi gerekir; KVKK veri en azaltma gereği toplanmaz.
- **Kendiliğinden geri dönüş** (`winback`): N gündür (7–365) gelmeyenlere kredi (1–20) ve "Seni özledik" bildirimi.
  - Aynı kişi bekleme süresi (30–365 gün) dolmadan yeniden almaz.
  - Günde en çok `dailyCap` kişi (1–2000) alır, en son bırakanlar önce (RES).

**Kimler alır, nasıl:** yalnız etkin, misafir olmayan, e-postası doğrulanmış USER hesaplar.
- Her hediye bir `LoyaltyGrant` satırıdır ve (kullanıcı, kural, dönem) tekildir, bu yüzden kimse iki kez almaz (BUS-02).
  Dönem: seri için ödeme günü, yıldönümü için yıl, geri dönüş için gün.
- Kredi hareketinde `loyalty:streak` / `loyalty:anniversary` / `loyalty:winback` yazar; uygulamada `kind: gift` görünür.
- Bildirim varsayılan Türkçe/İngilizce metinle gider; panelde kural başına özel metin (en çok 140 karakter) yazılabilir.

**Günlük iş:** `loyalty`, her gün 11:00 (İstanbul). Yıldönümü ve geri dönüşü verir ve JobRun'a yazar. Yeniden
çalıştırmak güvenlidir.

**Uçlar**
| Yöntem | Yol | Rol | Açıklama |
|---|---|---|---|
| GET | `/admin/loyalty` | SUPPORT | `settings`, `stats` (kural başına son 30 gün kişi ve kredi, toplam), `today` (bugün kim alır: `anniversary`, `winback`, `winbackWaiting`), `lastRun`, `version` |
| PATCH | `/admin/loyalty` | ADMIN | `{ settings, reason, version }`. Üç kural birlikte gönderilir; sınır dışı ya da bilinmeyen alan 400, eski sürüm 409 |
| POST | `/admin/loyalty/run` | ADMIN | `{ reason }` → `{ anniversary, winback }`. Günlük işi şimdi çalıştırır; o gün zaten alan yeniden almaz |

Denetim kaydında `loyalty.update` (değişiklik listesiyle) ve `loyalty.run` görünür.

### 7.36 Planlı fiyat değişikliği — backend + admin
Casalume'un kendi belirlediği fiyatlar zamanlanır (**Admin → Gelir ve maliyet → Planlı fiyatlar**):
- bir aracın kredi bedeli (§7.25.1; 1–10);
- bir paketin verdiği kredi (§7.21; 1–10000).

Mağaza fiyatları (App Store Connect, Play Console) buradan değişmez.

**Akış**
- Plan; araç ya da paket, yeni değer, başlangıç ve isteğe bağlı bitiş ister.
  - Başlangıç geçmişte olamaz (5 dk tolerans) ve en çok bir yıl sonrası olabilir.
  - Geçici değişiklik 15 dakika ile 180 gün arası sürer.
  - Bitiş yoksa değişiklik kalıcıdır.
- Aynı araç ya da paket için aralıkları çakışan iki plan olamaz (409 `overlap`, kilit altında).
- Değişiklik katalogların kendisine yazılır: panelde görünen, o an geçerli olandır. `price-schedules` işi her dakika
  çalışır:
  - başlangıcı gelen planı uygular ve eski değeri `previousValue` olarak saklar;
  - bitişi gelende eski değere döner.
- Geri dönüş yalnız değer hâlâ planlanan değerse yapılır. Biri arada elle değiştirdiyse dokunulmaz ve sonuçta yazar.
- Her adım satırı koşullu güncellemeyle sahiplenir; iki çalışma aynı adımı yapamaz (BUS-02).
- Durumlar: `SCHEDULED`, `ACTIVE`, `DONE`, `CANCELLED`, `FAILED` (araç ya da paket katalogdan kalkmışsa).

**Uçlar**
| Yöntem | Yol | Rol | Açıklama |
|---|---|---|---|
| GET | `/admin/price-schedules` | SUPPORT | `targets` (araç ve paketler, bugünkü değerleriyle) ve `items` (açık planlar önce, sonra son 50) |
| POST | `/admin/price-schedules` | ADMIN | `{ kind: tool\|pack, key, value, startsAt, endsAt\|null, reason }` → 201 `{ id }` |
| POST | `/admin/price-schedules/:id/cancel` | ADMIN | `{ reason }`. Başlamamışsa iptal eder (`cancelled`); sürüyorsa şimdi bitirir (`ended`); kapanmışsa 409 |

Denetim kaydında `price_schedule.create` ve `price_schedule.cancel` (yönetici) görünür; `price_schedule.start`,
`price_schedule.end` ve `price_schedule.failed` sistem tarafından yazılır.

### 7.37 Oturumlar ve giriş geçmişi — backend + web + admin (mobil sonra)
Kullanıcı açık oturumlarını görür ve kapatır (web: **Hesabım → Oturumlar**). Destek ekibi aynısını kullanıcı
ayrıntısında görür (**Admin → Kullanıcılar → kullanıcı → Açık oturumlar / Son giriş denemeleri**; YediOda #5–6).

**Oturum nedir:** her giriş bir refresh ailesidir ve bir `AuthSession` satırı açar. Satırda şunlar tutulur:
- yöntem: password / register / guest / google / apple;
- cihaz etiketi: "Chrome · macOS", "Casalume iOS 1.4.0";
- kısaltılmış IP: IPv4 /24, IPv6 /48 (KVKK veri en azaltma);
- açılış ve son etkinlik.

Web BFF ziyaretçinin tarayıcısını (`user-agent`) API'ye iletir; uygulama `X-App-Platform` ve `X-App-Version` gönderir.

**Anında kapatma (SES-04):** uygulama erişim token'ı oturumu `sid` olarak taşır ve `UserGuard` her istekte oturumun
açık olduğunu kontrol eder. Kapatılan oturumun erişim token'ı bir sonraki istekte 401 alır, refresh token'ı da
geçersizdir; kişinin diğer cihazları çalışmaya devam eder.
- Çıkış ve refresh token'ın tekrar kullanılması (SES-05) da o oturumu kapatır.
- Parola sıfırlama, ban ve "hepsini kapat" bütün oturumları kapatır.
- Bu sürümden önce açılmış oturumlar ilk yenilemede yöntemi `unknown` olarak kaydedilir.

**Giriş geçmişi:** var olan hesaplardaki başarılı ve başarısız denemeler (`bad_password`, `bad_second_factor`,
`suspended`); admin girişleri dahil. Bilinmeyen e-postalarla yapılan denemeler hiç tutulmaz. 90 gün saklanır;
kapanmış ya da 90 gündür kullanılmamış oturumlar da o zaman silinir (saklama işi).

**Uçlar**
| Yöntem | Yol | Rol | Açıklama |
|---|---|---|---|
| GET | `/me/sessions` | oturum | `{ items: [{ id, device, ipPrefix, method, createdAt, lastUsedAt, current }] }` |
| DELETE | `/me/sessions/:id` | oturum | 204. Kendi oturumu değilse 404. Bu cihazınki de kapatılabilir (çıkış gibi) |
| POST | `/me/sessions/revoke-others` | oturum | `{ revoked }`. Bu cihaz dışındakileri kapatır |
| GET | `/me/logins` | oturum | Son 20 deneme: `{ ok, method, reason, device, ipPrefix, createdAt }` |
| GET | `/admin/users/:id/sessions` | SUPPORT | `{ sessions, logins }` (son 50 deneme) |
| POST | `/admin/users/:id/sessions/:sid/revoke` | ADMIN | `{ reason }`. Denetim: `user.session_revoke` |
| POST | `/admin/users/:id/sessions/revoke-all` | ADMIN | `{ reason }`. `tokenVersion` artar. Denetim: `user.sessions_revoke_all` |

### 7.38 Parola kuralı ve yöneticinin parola değiştirmesi — backend + web + admin
**Kural** (PWD / ASVS V6.2, NIST 800-63B): kayıt, parola sıfırlama ve yöneticinin kendi değişikliği için aynıdır.
- Uzunluk: kullanıcı en az 10, yönetici en az 12, en çok 128 karakter (bayt değil, karakter sayılır).
- Reddedilenler (400 `weak_password`, `reason` alanıyla):
  - `common`: listedeki yaygın parolalar ve sonuna rakam ya da işaret eklenmiş halleri (`password2026!`,
    `Galatasaray1905`). Liste: SecLists'in en yaygın 3000 parolası (kaynağı sabitlenmiş, MIT,
    `apps/backend/assets/security/README.md`) ile Türkçe, klavye ve marka sözcükleri;
  - `contains_email`: e-posta adresinin kullanıcı adı kısmını içeren parola;
  - `repetitive`: en çok iki farklı karakterden oluşan parola;
  - `too_short`, `too_long`.
- Karakter türü zorlaması ve sessiz kırpma yoktur. Uzun, kişisel cümleler kabul edilir.
- Liste eksikse ya da 3000 girdiden azsa API başlamaz (fail-closed). Hiçbir dış servise parola gönderilmez.
- Parola sıfırlamada kural bağlantı harcanmadan önce uygulanır; reddedilen parola bağlantıyı yakmaz.
- Web `weak_password` için kendi çevirisini gösterir (11 dil).

**Yöneticinin parolası:** `POST /admin/me/password` `{ currentPassword, newPassword }`; panelde **Hesabım →
Parolayı değiştir**.
- Mevcut parola gerekir (ASVS V6.2.3). Yanlışsa 403 `step_up_failed`; deneme sayısı yönetici başına 15 dakikada 5.
- Yeni parola aynıysa 400 `same_password`.
- Başarılı değişiklikten sonra bütün oturumlar kapanır (SES-04) ve panel yeniden girişe yönlendirir. E-posta
  bildirimi gider; denetim kaydında `admin.password_changed` görünür (başarısızsa `admin.password_change_failed`).
