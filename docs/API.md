# AI Room — Sistem mimarisi ve API sözleşmesi (v1)

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
- **TOK-01 / TOK-02:** JWT yalnız HS256, `iss=ai-room`, `aud` = `ai-room-app` (kullanıcı) veya
  `ai-room-admin` (yönetici), `typ=access`. Admin token'ı yalnız MFA tamamlanınca verilir (`amr: ["pwd","otp"]`).
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

## 4. Admin uçları (`aud=ai-room-admin`, rol ADMIN, MFA tamam)

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
Marka: **AI Room** — "Odanı saniyeler içinde yeniden tasarla".
