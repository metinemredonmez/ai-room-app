# AI Room Admin

AI Room yönetim paneli: Next.js 16 (App Router) + TypeScript + Tailwind CSS v4. Port **3001**.
Backend sözleşmesi: [`docs/API.md` §4](../../docs/API.md).

## Çalıştırma

```bash
cp .env.example .env.local   # API_BASE_URL=http://localhost:4000/v1
npm install
npm run dev                  # http://localhost:3001
```

Üretim: `npm run build && npm run start`. Kontroller: `npm run lint`, `npm run typecheck`.

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `API_BASE_URL` | evet | Backend `/v1` taban adresi (yalnız sunucu tarafında kullanılır) |
| `IMAGE_ORIGINS` | hayır | Görsellerin geldiği ek origin'ler (CSP `img-src`), virgülle ayrılır |
| `ADMIN_ORIGIN` | üretimde önerilir | Panelin tam origin'i; CSRF `Origin` kontrolü bununla yapılır |

## Sayfalar

Gösterge paneli (KPI + günlük tasarım/yeni kullanıcı grafikleri, araç/stil dağılımı, 7/30/90 gün),
Kullanıcılar (arama, detay: plan, durum, kredi ayarı, hareketler, son tasarımlar), Tasarımlar
(durum/araç/stil/kullanıcı filtresi, öne çıkarma, silme), Stiller (oluştur/düzenle, palet, prompt,
PRO/aktif), Denetim kaydı, Sistem (AI/DB/Redis durumu).

## Güvenlik

- **Giriş (AUT-01):** e-posta + parola + 6 haneli TOTP → `/api/auth/login` → backend
  `POST /v1/admin/auth/login`. Token tarayıcıya verilmez; `HttpOnly; SameSite=Strict; Secure (prod)`
  çerezde durur (SES-01). Süresi backend'in `expiresIn` değeridir; yenileme yoktur.
- **BFF:** tarayıcı yalnız `/api/admin/*` çağırır; route handler çerezdeki token ile backend'e
  `Bearer` olarak iletir. Yol parçaları `[A-Za-z0-9_-]` ile sınırlıdır. Backend 401 dönerse çerez
  silinir ve arayüz giriş sayfasına döner.
- **CSRF (WEB-03):** POST/PATCH/DELETE isteklerinde `Origin` (ve varsa `Sec-Fetch-Site`) aynı
  origin olmalı; yoksa 403.
- **Başlıklar:** istek başına nonce'lu CSP (`script-src 'nonce-…' 'strict-dynamic'`,
  `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`,
  `X-Robots-Tag: noindex`, `robots.txt` her şeyi kapatır.
- `src/proxy.ts` yalnız iyimser yönlendirme yapar; yetki kararı her istekte backend'dedir
  (`aud=ai-room-admin`, rol ADMIN, MFA tamam — AZ-05).
- Kullanıcı ve AI kaynaklı metinler yalnız React metni olarak basılır; HTML olarak işlenmez.

## v1.1 ekranları

| Sayfa | Yol | Backend ucu |
|---|---|---|
| İçerik bildirimleri | `/reports` | `GET/PATCH /v1/admin/reports` — çöz / reddet, galeriden kaldır, tasarımı sil |
| AI maliyeti | `/ai-costs` | `GET /v1/admin/ai/usage` — bugünkü harcama, bütçe durumu, günlük grafik, sağlayıcı/iş kırılımı |
| Ayarlar | `/settings` | `GET/PATCH /v1/admin/settings` — kota, varyant, bütçe freni, bakım, duyuru, AI onayı; gerekçe zorunlu |
| Zamanlı işler | `/jobs` | `GET /v1/admin/jobs` — kuyruk sayaçları ve son çalışmalar |
