# Casalume — iş listesi (4 Kasım 2026)

Hedef kitle: **herkes** — ev sahibi, kiracı, dekorasyon meraklısı **ve** mimar / iç mimar. Varsayılan deneyim basit
kalır; profesyonel ihtiyaçlar (proje, müşteri, sunum) PRO ve “Profesyonel” katmanında toplanır.

## Ana fark: seçilen nesneyi değiştirmek (en önemli)
Tam oda yeniden tasarımı **kalır** (bir özellik olarak); ama odanın tamamını değiştirmek kolay ve çoğu uygulamada var,
üstelik kemer, pencere gibi mimariyi de değiştirebiliyor. Casalume’un farkı: kullanıcı odadaki **bir şeye odaklanır**
(yastıklar, koltuk, sehpa, avize…) ve **yalnız o** değişir, odanın geri kalanı piksel piksel aynı kalır.
- Yazarak: “Değiştir” aracına ad yazılır (“yastık”), SAM 3 o türün hepsini maskeler, bölge kilidi maske dışını korur.
- [x] Dokun-seç (API.md §7.15): Değiştir, Nesne Sil ve Duvar Boyası’nda fotoğrafa dokunulur; her dokunuş bir nesne (SAM 3
  nokta istemi), en çok 8. Maske üretimden önce çıkarılır; hiçbir şey bulunamazsa görsel üretilmez, hak iade edilir.
- [x] Maske önizlemesi (`POST /v1/uploads/:id/selection`), çoklu seçim, geri al/temizle — web stüdyosunda.
- [x] `FAL_KEY` sunucuda (4 Kasım). Ama fal.ai hesabı **“User is locked. Reason: TOP_UP”** — bakiye yüklenene kadar
  her SAM 3 isteği 403 (sahibi yükleyecek: https://fal.ai/dashboard/billing). O zamana dek seçim 502 verir.
- [ ] Bakiye gelince canlıda gerçek fotoğrafla dene (hazır betik: tek misafir hesap, 5 seçim + 1 tasarım):
  - metinsiz nokta istemi doğru nesneyi veriyor mu (belgede varsayılan `prompt` “wheel” görünüyor), maske sınırları iyi mi;
  - **yazarak seçimde Türkçe ad** (“yastık”, “koltuk”): SAM 3 İngilizce kelime bekliyor olabilir — anlamazsa hedef
    İngilizceye çevrilmeli (bu, mevcut otomatik kilidi de etkiler).
- [ ] Mobil dokun-seç arayüzü (sen): aynı uç ve `points` alanı; katalogda `needs.points`.
- Mobil için hazır kimlikler (4 Kasım; gizli değil): Expo projectId `0e6e7543-8b53-419b-b3ea-9b1fb83ae929` (slug `casalume`);
  Google OAuth iOS `…rolsejjn66v5dplhbtburkfkkf0mkien`, Android `…h88dnd5rfe85hapdftsc0c0p5iupleqj`, Web
  `…tgi66u4p9mjrir8pik26dc5e3pobpm6i` (hepsi `611319732235-` ile başlar, `.apps.googleusercontent.com` ile biter);
  Firebase projesi `ai-room-35914`. Dosyalar sahibinin Mac’inde `~/Documents/casalume-keys/`: Android imza anahtarı
  `casalume-upload.jks` (alias `casalume`, parola Anahtar Zinciri’nde `casalume-android-keystore`), `google-services.json`,
  `GoogleService-Info.plist`, Firebase servis hesabı JSON’u. Hiçbiri repoya girmez.
- [ ] Android imzası (sahibinin kararı, 4 Kasım): fal-app’teki gibi normal EAS derlemesi; anahtarı Expo üretir. İlk Android
  derlemesinden **sonra** expo.dev → Credentials → Android’deki SHA-1’i (1) Google Cloud → Clients → Android istemcisine
  (eskisinin yerine) ve (2) Firebase → Casalume Android → SHA fingerprints’e ekle, `google-services.json`’ı yeniden indir.
  Mac’te üretilen `casalume-upload.jks` kullanılmıyor.
- [ ] Mobil başlayınca (sen): expo.dev → Credentials → Android → FCM V1 servis hesabı JSON’unu yükle; bildirimler başlayınca
  Expo’da “Enhanced push security” aç, erişim jetonunu sunucuya `EXPO_ACCESS_TOKEN` olarak gir. `app.json`’a
  `extra.eas.projectId` ve `"owner": "metinemredonmez"` eklenecek.
- Gemini ile maske denendi (4 Kasım, `gemini-3.8-flash`, örnek salon): nesneyi ve kutusunu doğru buluyor ama piksel
  maskesi yok, çokgen maske kayık ya da tamamen yanlış (koltuğa dokununca duvarı seçti). Bölge kilidi için **kullanılamaz**;
  `gemini-2.5-flash` yeni hesaplara kapalı.
- [ ] Kendi segmentasyon motorumuz (fal.ai’ye yedek, veri bizde kalır). Karar: ikisi birden — fal.ai SAM 3 birincil, bu yedek.
  Adaylar:
  - Google MediaPipe Interactive Segmenter (MagicTouch) — **denendi** (4 Kasım, hazal, örnek salon): dokunuş başına 0,3 sn,
    ücretsiz. Koltuk ve sehpa sınırları keskin; ama yastığa dokununca bütün koltuğu seçiyor, duvarda parça parça leke.
    → Değiştir / Nesne Sil için büyük eşyada yedek olur; Duvar Boyası için olmaz. hazal’da yalnız `mediapipe==0.10.21`
    çalıştı (0.10.35 ve 1.2 sistemde libGLES/libEGL istiyor; sistem paketi kurulmadı) + `opencv-contrib-python-headless`.
  - SAM 2.1 (Apache 2.0) ONNX: daha keskin ama hazal’da (2 çekirdek / 5 GB paylaşımlı) ilk dokunuşta birkaç sn CPU dolu;
    daha iyisi Kaptan GPU’su.
  - Vertex AI `image-segmentation-001`: servis hesabı ister, izin listesine bağlı görünüyor (Kasım 2026) — şimdilik değil.
  Paket ve model dosyası indirilmeden önce onay alınır.
- [ ] Nesneye komut: renk, kumaş/malzeme, stil, kaldır, başka ürünle değiştir (referans görsel), varyant karşılaştırma.
- [ ] Kalite ölçümü: maske dışı fark ≈ 0 (bugünkü `masked_mean_abs_diff`), maske içi gerçekten değişmiş; değerlendirme setine nesne vakaları.

Dünyada benzerleri (4 Kasım 2026 taraması; kaynakların çoğu satıcı blogu, denenerek doğrulanmalı):
- Remodel AI “Furniture Swap” ve Ideal.house (mobilyayı kendisi bulur, duvar/zemine dokunmaz) parça değiştiriyor;
  Home-design.ai fırçayla boyayarak seçtiriyor; RoomLab ve Edensign istenen ürünün fotoğrafını yükletip odaya yerleştiriyor.
- Interior AI nesneye dokununca benzer ürünleri gösteriyor; ReimagineHome ve ShopTheRoom tasarımdaki eşyaları satın
  alma bağlantısına çeviriyor (eBay, Etsy). Ortak şikâyet: tam oda araçları oda geometrisini bozuyor.
- Bizden çıkacaklar:
  - [ ] Seçim üç yolla: dokun (SAM 3 nokta — yapıldı), kutu, fırça.
  - [ ] “Bu ürünü koy”: kullanıcı ürün fotoğrafı ya da bağlantısı verir, seçili nesnenin yerine o gelir.
  - [ ] Seçili nesne için Türkiye’deki mağazalardan benzer ürün ve TL fiyat (alışveriş listesiyle birleşir).
  - [ ] “Odan bozulmaz” sözü: maske dışı değişmezlik ölçülür, gerekirse sonuç reddedilip yeniden üretilir.

## Şu an
- [x] Dört renk teması (Kil · Pirinç · Mürekkep · Erik): web (başlıktaki seçici) ve admin (kullanıcı menüsü). Açık tema varsayılan.
- [x] Web ana sayfası: gerçek fotoğraflar (Nano Banana 2 önce/sonra), Casalume logosu, ince serif başlıklar.
- [x] Stil kartları: 15 stilin gerçek önizlemesi Nano Banana 2 ile (`apps/backend/assets/styles/`).
- [ ] Web fiyatlar: “Seç” → “Uygulamadan abone ol” (App Store / Google Play); canlıda demo PRO düğmesi gizli.
- [ ] Admin “Planlar”: web’de görünen plan fiyatları ve rozetler koddan değil ayarlardan (gerçek ücret mağazalarda).

## Ürün — gerçek kullanıcılardan önce (P0)
- [ ] KVKK metinleri fal-app derinliğinde (aydınlatma, açık rıza, yurt dışı aktarım, saklama süreleri, çerez, başvuru).
- [ ] İlham galerisi için kullanıcı izni (tasarım başına; geri çekince galeriden kalkar).
- [ ] Sohbet ve alışveriş listesi: Kaptan (Türkiye’de, OpenAI uyumlu) — şimdilik canlıda “kullanılamıyor”.
- [ ] Mobil: açık rıza ekranı, “İçeriği bildir”, zorunlu güncelleme, dört renk, açılış animasyonu (palemi tarzı).
- [ ] Mobil: Google ve Apple ile giriş (backend hazır).
  - Apple ile giriş canlıda **dört değeri birlikte** ister: `APPLE_CLIENT_IDS=app.casalume` + `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
    `APPLE_PRIVATE_KEY` (Sign in with Apple anahtarı .p8; hesap silinince Apple oturumu iptal edilir, App Store 5.1.1(v)) ve
    `FIELD_ENC_KEY`. Yalnız `APPLE_CLIENT_IDS` girilince backend açılmıyor (4 Kasım’da API bu yüzden kısa süre düştü).
  - [x] 4 Kasım: hepsi sunucuda (Team `6DV7YZY2XY`, App ID `app.casalume` + Sign In with Apple + Push, anahtar
    `H7N2ARLFCD`; .p8 sahibinin Mac’inde `~/Documents/casalume-keys/`). API sorunsuz açıldı.
  - [ ] İsteğe bağlı: Apple’ın gizli e-posta yönlendirmesi (Services → Sign in with Apple for Email Communication) için
    `casalume.app` ve `no-reply@casalume.app` kaydı — e-postasını gizleyen Apple kullanıcılarına posta gidebilsin.
- [ ] Bildirimler (push): Expo projesi, APNs anahtarı (Apple), FCM (Google); “Tasarımın hazır” ve kampanya izni ayrı.
- [ ] Tam veri sorumlusu adresi (KVKK m.10) — şu an yalnız “Maltepe, İstanbul”.

## Görsel motoru
- [x] Varsayılan model Nano Banana 2 (`gemini-3.1-flash-image`); 2.5 / 3.1 / 3 Pro karşılaştırması yapıldı.
- [ ] PRO aboneler için “Yüksek kalite”: Nano Banana Pro (`gemini-3-pro-image`); maliyet defterine fiyatı.
- [ ] Yedek sağlayıcı: Runware (anahtar alındı, sağlayıcı yazılacak).
- [ ] Araç başına en iyi model: 20–30 gerçek oda fotoğrafından değerlendirme seti; boya/zemin gibi geometri korumalı işler ayrı.
- [ ] İleride: açık model (FLUX.2 / Qwen-Image-Edit) Kaptan GPU’sunda — veri Türkiye’de, görsel başı maliyet düşük.

## Mimarlar için (Profesyonel katman)
- [ ] Projeler: bir müşteri / ev altında çok oda, notlar.
- [ ] Müşteriye paylaşım bağlantısı (süreli, izinli) ve yorum.
- [ ] Logolu PDF sunum: önce/sonra, malzeme listesi, bütçe.
- [ ] Filigransız yüksek çözünürlük (2K/4K), toplu üretim, varyant karşılaştırma.
- [ ] Ekip hesabı (birden çok mimar), fatura bilgisi.
- [ ] Malzeme ve ürün listesi marka/ürün koduyla; ölçü ve kat planı (araştırılacak).

## Çok dilli sürüm
maeyja’daki 11 dil (tr, en, de, es, fr, it, ru, nl, ja, ko, zh), API.md §7.17. Görsel talimatları İngilizce kalır (modelin en
iyi anladığı dil); kullanıcı dili ayrı.
- [x] Web: dile göre adresler (Türkçe öneksiz, `/en`, `/de` …), tarayıcı diline göre yönlendirme, dil seçici, hreflang’li
  sitemap, her dilde 404 ve sayfa başlıkları. 338 metin 9 dile Claude ile çevrildi (`scripts/i18n_fill.py`).
- [x] Backend: 11 dil kabul edilir; katalog adları (araç, oda, zemin, renk, plan, stil) dosyadan çevrilir, tasarım başlıkları
  kullanıcının dilinde.
- [x] AI sohbet ve maliyet analizi kullanıcının dilinde.
- [x] Admin toplu gönderimde kitle dili 11 dil.
- [ ] E-posta (doğrulama, şifre sıfırlama, toplu gönderim alt bilgisi) ve push metinleri yalnız TR/EN; diğer diller İngilizce
  alıyor. Bu metinler de `i18n_fill` ile çevrilecek.
- [ ] Hata mesajları (`error.message`) Türkçe; web kendi çevirisini gösteriyor, mobil için bakılacak.
- [ ] Yasal metinler her dilde (KVKK + AB için GDPR) — avukat onayı gerekir; şimdilik Türkçe dışı herkese İngilizce.
- [ ] Para birimi (TL, EUR, USD) ve mağaza bağlantıları ülkeye göre; alışveriş listesi şimdilik Türk mağazaları.
- [ ] AR (sağdan sola düzen gerekir) — sonra.
- [ ] Admin: yeni stil eklenince diğer dilleri AI ile doldurma düğmesi (maeyja `translation-fill`), insan onayıyla yayın.
  Şimdilik yeni stil adı Türkçe dışı dillerde İngilizce görünür.
- [ ] Mağaza sayfaları ve ekran görüntüleri her dilde; mobil dil seçimi (sen).

## Pazarlama AI ajanları (sahibinin isteği, 4 Kasım; kapsam seçildi)
Mobil sürümün ve sitenin pazarlaması için. Hepsi admin’de **Pazarlama** bölümünde **taslak** üretir; sahibi onaylamadan
hiçbir şey yayınlanmaz, gönderilmez (AI-02: ajanların aracı yok, yalnız metin/görsel üretir). Instagram/TikTok’a
paylaşım **elle** (Meta onayı gerekmez). Örnekler: maeyja `ai-tools` (yanıt taslağı, Instagram açıklaması, haftalık özet),
`ai-studio` (onay kuyruğu); fal-app `seo` (Search Console + GA4 raporu, sayfa ayarları).

Ortak altyapı (ilk adım):
- AI servisi `/internal/v1/marketing/<tür>`: Claude Opus 5.5, yapılandırılmış çıktı (tür başına JSON şeması), Casalume
  ses tonu + doğru bilgi sayfası (özellikler, fiyatlar katalogdan, 11 dil). Bilmediği özelliği uydurmaz.
- Maliyet `AiUsage` defterine (`kind=marketing`); günlük bütçe kesicisi geçerli. Admin başına hız sınırı (RES).
- Backend `MarketingDraft` tablosu (tür, dil, girdi, çıktı, durum TASLAK/ONAYLI/ARŞİV, yazan, maliyet);
  `v1/admin/marketing/*`; üretmek EDITOR+, onaylamak ADMIN+; denetim kaydı. Uzunluk sınırları sunucuda da denetlenir.
- Admin: kenar çubuğunda “Pazarlama” grubu.

Sıra:
- [x] 1. **Mağaza metni (ASO)** (API.md §7.18; admin → Pazarlama → Mağaza metni) — App Store: ad ≤30, alt başlık ≤30, anahtar kelime ≤100 (virgülle, addaki sözcükler
  tekrar edilmez), tanıtım metni ≤170, açıklama ≤4000, yenilikler. Google Play: başlık ≤30, kısa açıklama ≤80,
  açıklama ≤4000. 11 dilde tek seferde; sınırı aşan alan bir kez yeniden istenir. Dışa aktarma: EAS Metadata
  `store.config.json` (App Store) + Play için dil başına metin paketi. Gerçek denemede Türkçe ve Japonca sınırların
  içinde çıktı; dil başına ≈0,1 $, ≈50 sn.
  - [ ] Mobil (sen): `store.config.json`’u `eas metadata:push` ile yükle; Play metinlerini Console’a yapıştır.
  - [ ] Mağaza ekran görüntüleri her dilde (sosyal medya ajanının görsel altyapısıyla birlikte).
- [x] 2. **Sosyal medya gönderisi** (API.md §7.18.1) — önce/sonra görseli sunucuda (sharp): kare 1080×1080 + story 1080×1920, Casalume
  imzalı; dile ve platforma göre (Instagram, TikTok, Pinterest) açıklama + etiketler; zip indirme.
  KVKK: kullanıcı fotoğrafı yalnız açık “tanıtımda kullanılabilir” onayıyla (yeni onay türü); o zamana kadar yalnız
  bizim örnek oda ve stil fotoğraflarımız (`assets/styles`).
- [x] 3. **Kampanya + haftalık rapor** (§7.18.2–3) — toplu gönderim için push/e-posta metni taslağı → ticari ifade kontrolünden
  geçip `Broadcast` TASLAK olarak açılır. Haftalık rapor: pazartesi 09:00 (İstanbul) sahibine e-posta — yeni kayıt,
  tasarım, ödeme, AI maliyeti, en çok kullanılan stiller, hatalar + Claude’un 5 satırlık yorumu.
- [x] 4. **SEO + blog** (§7.18.4–5; web `/blog`, onaylı SEO metni siteye ≈5 dk içinde) — web’e blog (`/blog`, `/<dil>/blog/<slug>`, Markdown, admin’den yayın, sitemap’e girer).
  Ajan: konu → taslak (Türkçe kaynak, diğer diller `i18n_fill` hattıyla), stüdyoya iç bağlantılar; mevcut sayfalar için
  11 dilde başlık ≤60 / açıklama ≤155 önerisi. Sonra: Search Console + GA4 verisi (fal-app deseni, Google hizmet hesabı
  gerekir).
- Tahmini maliyet: ASO 11 dil ≈ 0,5–1 $; blog yazısı dil başına ≈ 0,2–0,5 $; sosyal gönderi ≈ 0,05 $.
- [ ] Sosyal medya: kullanıcı tasarımlarını tanıtımda kullanmak için açık onay türü (`showcase`) + admin seçimi.
- [ ] SEO: Search Console + GA4 verisi (fal-app `seo` deseni) — Google hizmet hesabı gerekir.
- [ ] Blog: onaylanınca web önbelleğini anında yenileme (şimdi birkaç dakika); yazıya iç bağlantı olarak stil sayfaları.
- [ ] Instagram'a panelden paylaşım (Meta onayı) — şimdilik elle.

## Diğer uygulamalardan alınacaklar (yoga, fal-app, palemi, maeyja)
Değere göre sıralı; kaynak dosyalar karşılaştırma raporunda. “(sen)” = mobil tarafı sahibinde.
- [ ] Web hesap sayfası (hesap silme, veri indirme, izinler) + yasal sayfalar + robots/sitemap/OG — Google Play hesap
  silme için web bağlantısı ister; backend (`DELETE /me`, `/me/export`) hazır. Kaynak: palemi `hesap/`, fal-app `legal/`.
- [ ] Mobilde KVKK başvurusu ve veri indirme ekranı (sen) — backend hazır.
- [ ] Destek talebi: kullanıcı formu (hata ekranındaki istek/iş kimliğiyle) + admin destek kutusu + yanıt bildirimi (palemi, fal-app).
- [ ] Herkese açık önce/sonra paylaşım sayfası (OG görseli, süreli, görüntülenme sayacı) — mimar müşteri bağlantısının
  da temeli (fal-app `share/`); mobilde story kartı 1080×1920 (sen, palemi).
- [ ] Uygulama içi olay ölçümü (KVKK uyumlu beyaz liste) + admin kohort/huni ekranları (fal-app `olaylar/`).
- [ ] Deneme süresi + dürüst paywall (ilk ücret tarihi düğmenin üstünde) + “Aboneliği yönet” + deneme hatırlatması (sen, palemi).
- [ ] Davet et – kazan (ücretsiz tasarım hakkı) + promosyon/hediye kodu + mimar/influencer ortaklık bağlantısı (fal-app).
- [x] Panelden toplu push/kampanya (API.md §7.16): pazarlama izni, haftalık sınır, sessiz saatler, ticari ifade kontrolü,
  test gönderimi, teslim ve açılma raporu (fal-app). Mobil (sen): bildirime dokununca `POST /v1/broadcasts/:id/opened`,
  Android `news` kanalı.
- [x] Toplu e-posta kanalı (maeyja kampanya modülü, API.md §7.16): doğrulanmış adreslere, kampanyada imzalı abonelikten çık
  (web `/abonelikten-cik`) + RFC 8058 tek tık, gönderen kimliği alt bilgide, günlük sınır (`emailDailyCap`, varsayılan 300),
  saniyede bir e-posta. E-posta şablonları eski “AI Room” markasından Casalume’a çevrildi.
- [ ] Toplu e-postayı büyük listelerde Brevo gibi bir sağlayıcıya taşımak (hazal paylaşımlı; itibar riski) — liste büyüyünce.
- [ ] Yaşam döngüsü e-postaları ve geri çağırma (fal-app).
- [ ] Sonuç geri bildirimi (“beğendim / bana uymadı” + neden) → admin’de red oranı; model değerlendirmesini besler (palemi).
- [ ] Onboarding sorusu “Ev sahibi misin, mimar mı?” → Profesyonel katmana yönlendirme; A/B deneyleri (fal-app, palemi).
- [ ] Kurucu uyarıları: disk/DB/model emekliliği/kota, ödeme bildirimi, haftalık KPI e-postası (fal-app).
- [ ] Bekleme listesi + bülten (mağazalar açılmadan web ziyaretçisi), admin CMS (SSS, ana sayfa) (fal-app, maeyja).
- [ ] Admin’de `support@casalume.app` gelen kutusu (maeyja `mailbox`, IMAP): kullanıcı e-postalarını panelden okuyup yanıtlamak.
- [ ] Kupon / hediye kodu ekranı (maeyja `coupons`, fal-app `promo`) — kredi paketleriyle birleşir.
- [ ] Giriş yapmışken şifre/e-posta değiştirme, aktif oturumlar, yeni giriş uyarısı (palemi, yoga).
- [ ] Mobil dokunuşlar (sen): haptik (`expo-haptics` kurulu ama kullanılmıyor), iskelet yükleyici, iOS yeniden kurulumda
  Keychain temizliği, uygulama içi değerlendirme istemi.

## Admin
- [ ] Eski görünümdeki 8 ekranı yeni tasarıma taşı (Kullanıcılar + detay, Stiller, Ödeme olayları, AI maliyeti, Zamanlı işler, Denetim, Sistem, Ayarlar kısmen).
- [ ] Admin’e her yerden güvenli erişim: Tailscale (şimdilik yalnız sahibin ev IP’si açık).

## Belgeler
- [x] Masaüstündeki diğer uygulamalarla (yoga, fal-app, palemi, maeyja) özellik karşılaştırması — yukarıda.
- [x] `Casalume-API-ve-Hesaplar.pdf` (Masaüstü): yedek yol haritası, servis başına kayıt adımları, teknolojiler, bildirimler.
- [x] Dünyadaki benzer uygulamaların özellik karşılaştırması — “Ana fark” bölümünde.
- [ ] Codex için bağımsız test ve denetim komutu — sahibi istedi: her şey bittikten sonra, en sonda yazılacak.

## İşletim
- [ ] Mağazalar: Apple Developer, Google Play Console, RevenueCat ürünleri (`casalume_*`).
- [ ] Sunucu dışı yedek (şifreli), uptime izleyici.
- [ ] Kendi hata alarmımız — Sentry yerine (sahibinin kararı, 4 Kasım): backend ve AI servisindeki 5xx / yakalanmamış hata
  → `support@casalume.app` e-postası (aynı hata saatte en çok bir kez) + admin’de “Hatalar” sayfası; fal-app
  `infra-watchdog` deseniyle disk, veritabanı, kota uyarıları. Mobil çökme raporu mağaza öncesi ayrıca düşünülecek.
- [ ] Sohbete düşen iki sırrı yenile (4 Kasım; sahibi sonra yapacak):
  - Firebase Admin SDK anahtarı (ai-room, `firebase-adminsdk-fbsvc`, 4 Kasım’da üretilen ilk anahtar): Cloud Console →
    IAM → Service accounts → Keys → sil; Firebase’den yenisini üret, yalnız `~/Documents/casalume-keys/`e koy.
  - Google OAuth “Casalume Web” client secret: Auth Platform → Clients → Casalume Web → secret’ı kapat/sil (kullanmıyoruz).
  - `Downloads` klasöründeki `client_secret_…json` ve `…firebase-adminsdk…json` dosyalarını sil.
- [ ] hazal’a fail2ban (e-posta girişlerine kaba kuvvet denemeleri görülüyor).
- [ ] Admin ilk girişi: Google Authenticator kurulumu ve `admin-credentials.txt`’nin silinmesi (sahibi yapıyor).
- [ ] hazal’daki diğer siteler (bilgi): maeyja.com 503 veriyor (Casalume öncesinden); uzmanumre.com’da DKIM/DMARC yok.
