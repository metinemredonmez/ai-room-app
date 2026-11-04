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
