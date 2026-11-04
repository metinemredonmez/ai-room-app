# Codex denetim komutu

Bu dosyanın tamamı Codex'e verilecek komuttur. Kullanım: repo kökünde `codex` aç, aşağıdaki "Komut" bölümünü olduğu
gibi yapıştır. Codex yalnız okusun ve test çalıştırsın, kod değiştirmesin (salt okunur mod).

---

## Komut

Sen bağımsız bir güvenlik ve kod kalitesi denetçisisin. Bu repo **Casalume**: fotoğraftan yapay zekâ ile iç mekân /
dış cephe / bahçe yeniden tasarımı yapan bir uygulama. Görevin bu repoyu denetleyip **Türkçe bir denetim raporu**
yazmak. Kod değiştirme, commit atma, dosya silme; yalnız oku, ara ve testleri çalıştır.

### Proje

Monorepo (`apps/`):

- `backend`: NestJS 12, Prisma 7, PostgreSQL, Redis + BullMQ. Kullanıcı ve admin API'si `/v1`.
- `ai-service`: FastAPI. Görsel üretimi; Claude ile sohbet, analiz ve pazarlama taslakları. Yalnız backend çağırır
  (`X-Internal-Token`).
- `admin`: Next.js 16 yönetim paneli. Tarayıcıdan backend'e yalnız `/api/admin/*` BFF üzerinden gider.
- `web`: Next.js 16 site ve stüdyo. 11 dil var; `src/proxy.ts` dil yönlendirmesi yapar; BFF `/api/*`.
- `mobile`: Expo uygulaması. **Kapsam dışı**: okuyabilirsin ama bulguları yalnız "bilgi" olarak yaz.

Belgeler:

- `docs/API.md`: sözleşme. Özellikle §7.15 dokunarak seçim, §7.16 Toplu Gönderim + e-posta, §7.17 çok dilli sürüm,
  §7.18 pazarlama ajanları.
- `docs/RUNBOOK.md`, `docs/BACKLOG.md`.

Canlı ortam: tek VPS'te pm2, önünde nginx. **Canlı sistemlere, sunuculara ya da dış servislere istek atma.**
`.env` dosyalarını açma, içeriğini rapora koyma.

### Kapsam ve öncelik

1. Bütün repo.
2. Özellikle `ce1e986..HEAD` aralığında eklenenler (`git log --oneline ce1e986..HEAD`, `git diff --stat ce1e986`):
   - Stil önizlemeleri.
   - Dokunarak seçim (SAM 3 nokta seçimi, `/v1/uploads/:id/selection`).
   - Toplu Gönderim: push ve e-posta kanalı, abonelikten çıkma HMAC bağlantısı, RFC 8058 tek tık.
   - 11 dilli web: `[locale]` rotaları, proxy, `next.config` rewrite başlığı, site haritası, robots.
   - Pazarlama ajanları: `apps/backend/src/marketing`, `apps/backend/src/blog`, `apps/ai-service/app/marketing.py`,
     admin `app/(panel)/marketing/*`, web `app/[locale]/blog`, `components/markdown.tsx`, `lib/content.ts`.

### Çalıştırılacak kontroller

Ağ gerektirmeyenleri çalıştır. Çalışmayanı rapora "Engellendi" olarak yaz; nedenini de ekle.

- **backend:**
  ```
  npm ci
  npx prisma generate
  npx tsc --noEmit -p .
  npm test
  npm run lint
  npm audit --omit=dev
  ```
- **ai-service:**
  ```
  uv sync
  uv run pytest -q
  ```
  `pip-audit` varsa onu da çalıştır.
- **web ve admin:**
  ```
  npm ci
  npx tsc --noEmit -p .
  npm run lint
  npm audit --omit=dev
  ```
  `npm run build` yalnız ortam izin verirse.
- **Sır taraması:** `gitleaks git --no-banner --redact`. Bulgu varsa yalnız dosya:satır ve kural adı yaz, değeri
  asla yazma.
- **Uçtan uca deneme:** `scripts/smoke.mjs` yerel Postgres, Redis, backend ve AI servisi ister. Ortam yoksa
  çalıştırma; yalnız ne denediğini oku ve eksik senaryoları yaz.

### Bakılacaklar

Her başlıkta önce kodu oku, sonra iddianı dosya:satır ile kanıtla. Tahmine dayalı bulgu yazma; emin değilsen durumu
"Doğrulanacak" yap.

1. **Kimlik ve yetki** (AUT, SES, AZ, TOK):
   - Admin girişi + TOTP (MFA zorunlu; kurtarma kodları; kayıt penceresi).
   - `MinRole` eksik bir admin ucu var mı? Beklenen davranış: rol bildirmeyen uç reddedilmeli (fail-closed).
   - BOLA: başkasının tasarımına, görseline, seçimine, KVKK başvurusuna erişilebiliyor mu?
   - JWT/refresh döngüsü, `tokenVersion` ile iptal, BFF çerezleri (httpOnly, Secure, SameSite).
   - Apple/Google ile giriş: nonce ve audience denetimi.
2. **Girdi doğrulama** (INP): zod şemaları `.strict()` mi, sınırlar var mı? Özellikle `MarketingDraft` düzenleme
   (`PATCH /admin/marketing/drafts/:id`, türüne göre şema) ve blog adresi (slug).
3. **XSS / HTML** (WEB-01):
   - `apps/web/src/components/markdown.tsx` blog gövdesini React öğesi olarak mı çiziyor? HTML'e kaçış yolu var mı?
     Bağlantı beyaz listesi (`ALLOWED`) atlatılabilir mi (`javascript:`, `//evil`, `/studio/../`)?
   - E-posta şablonlarında `escapeHtml` her yerde kullanılmış mı (`mail/mailer.service.ts`,
     `broadcasts/broadcast.mail.ts`, `marketing/weekly-report.ts`)?
   - `dangerouslySetInnerHTML` kullanımları.
4. **Yönlendirme ve proxy** (NET, EXT, DSY):
   - `apps/web/src/proxy.ts`: açık yönlendirme var mı? `air_locale` çerezi ve `Accept-Language` ile yönlendirme
     güvenli mi?
   - `x-casalume-default-locale` başlığını istemci gönderirse ne olur? Proxy silmeli; proxy'nin çalışmadığı yollar
     da var: `api/`, `_next/`, dosya uzantılı yollar.
   - `next.config.ts` rewrite.
   - Admin BFF yol segmenti denetimi, `X-Forwarded-For` güveni (`clientIp`), CORS.
5. **SSRF ve dış çağrılar** (EXT): AI servisinin sağlayıcı çağrıları; backend'in AI servisine çağrıları; kullanıcı
   girdisinden URL üretilen bir yer var mı? Toplu gönderim bağlantıları yalnız uygulama içi mi (`LINK_RE`)?
6. **Dosya yükleme** (FIL): boyut, tür, çözümleme; imzalı görsel URL'leri (süre, imza karşılaştırması).
7. **Hız ve maliyet sınırları** (RES):
   - `LIMITS`; pazarlama çalıştırmaları (saatte 10, çalıştırma başına en çok 30 taslak).
   - Günlük AI bütçe kesicisi gerçekten bütün AI yollarını kesiyor mu?
   - Kuyruk tekrarları sonsuz maliyet doğurabilir mi?
8. **Yapay zekâ** (AI):
   - Kullanıcı ve admin metni modele "veri" olarak mı gidiyor (prompt injection)?
   - Model çıktısı güvenilmeyen girdi gibi denetleniyor mu (katalog kimlikleri, bağlantılar, sayfa anahtarları,
     uzunluklar)?
   - Ajanların bir aracı ya da yayın yetkisi yok mu (AI-02)? Taslak onaylanmadan yayına bir yol var mı?
9. **KVKK ve ticari ileti** (DAT):
   - Pazarlama izni gönderim anında denetleniyor mu?
   - Abonelikten çıkma bağlantısında e-posta yok mu, imza doğru mu?
   - İYS ticari ifade sınıflandırıcısı atlatılabilir mi?
   - Sosyal medya görsellerinde kullanıcı fotoğrafı kullanılmadığı doğru mu?
   - Haftalık raporda kişisel veri var mı?
10. **Loglama** (LOG): log'a sır, token, e-posta adresi ya da metin içeriği yazılıyor mu? Denetim kaydı bütün admin
    yazma işlemlerinde var mı?
11. **Doğruluk ve dayanıklılık:**
    - Yarış koşulları: kredi düşümü, toplu gönderimde "en çok bir kez" teslim, taslak onayında arşivleme, blog
      slug çakışması.
    - Kuyruk işleri tekrar çalışırsa ne olur (idempotency)?
    - Takılan işler nasıl temizleniyor?
    - Migration'lar geri alınabilir ya da güvenli mi?
12. **Önbellek** (Next 16 `"use cache"`): `apps/web/src/lib/content.ts` yalnız herkese açık veriyi mi önbelleğe
    alıyor? Kullanıcıya özel veri önbelleğe girebiliyor mu?
13. **Belge ile kod tutarlılığı:** `docs/API.md` ile uçlar, durum kodları ve sınırlar aynı mı? `openapi` çıktısı?
14. **Test eksikleri:** kritik yollardan testi olmayanlar (olumlu + olumsuz senaryo).

### Rapor biçimi

Raporu `docs/rapor/codex-denetim-<YYYY-MM-DD>.md` olarak öner. Dosyayı yazamıyorsan yanıtında ver. Türkçe yaz, kısa
cümlelerle.

1. **Özet**: 5–8 satır. En önemli üç risk, genel durum. "Hiç açık yok" gibi mutlak ifade kullanma; denetimin
   kapsamını ve sınırını yaz.
2. **Çalıştırılan kontroller**: komut, sonuç (geçti / kaldı / engellendi), kısa çıktı.
3. **Bulgular tablosu**: önem sırasına göre.
   - Sütunlar: No · Önem (Kritik / Yüksek / Orta / Düşük / Bilgi) · Başlık · Dosya:satır · Kontrol (ör. AZ-01,
     WEB-01, OWASP A01) · Durum (Doğrulanacak / Kaldı / Geçti / Risk kabul edilebilir).
4. **Bulgu ayrıntıları**: her bulgu için şunlar.
   - Ne yanlış.
   - Kanıt: kod alıntısı en çok 10 satır.
   - Nasıl istismar edilir ya da nasıl bozulur: somut girdi → sonuç.
   - Etkisi.
   - Önerilen düzeltme: kod önerisi kısa olsun.
   - Doğrulamak için eklenecek test.
   - Güvenlik bulgularına CVSS 3.1 vektörü ekle; puanı abartma.
5. **İyi yapılanlar**: kısa liste. Hangi kontroller yerinde, dosyasıyla.
6. **Öncelikli yapılacaklar**: en çok 10 madde, sırayla.

Kurallar:

- Sırları, token'ları, e-posta adreslerini ve IP'leri rapora yazma; gerekiyorsa maskele.
- Bir bulguyu kanıtlayamıyorsan "Doğrulanacak" diye işaretle ve neyin kontrol edilmesi gerektiğini yaz.
- Aynı kök nedeni taşıyan bulguları tek bulguda birleştir; etkilenen bütün yerleri listele.
