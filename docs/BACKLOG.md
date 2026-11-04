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
- [ ] Canlıda `FAL_KEY` (SAM 3) — **olmadan dokun-seç kapalı** (503, web yazarak seçime döner) ve otomatik kilit de çalışmaz.
- [ ] `FAL_KEY` girilince canlıda gerçek fotoğrafla dene: metinsiz nokta istemi doğru nesneyi veriyor mu (belgede varsayılan
  `prompt` “wheel” görünüyor), maske sınırları iyi mi.
- [ ] Mobil dokun-seç arayüzü (sen): aynı uç ve `points` alanı; katalogda `needs.points`.
- Gemini ile maske denendi (4 Kasım, `gemini-3.8-flash`, örnek salon): nesneyi ve kutusunu doğru buluyor ama piksel
  maskesi yok, çokgen maske kayık ya da tamamen yanlış (koltuğa dokununca duvarı seçti). Bölge kilidi için **kullanılamaz**;
  `gemini-2.5-flash` yeni hesaplara kapalı.
- [ ] Kendi segmentasyon motorumuz (fal.ai’ye yedek, veri bizde kalır). Karar: ikisi birden — fal.ai SAM 3 birincil, bu yedek.
  Adaylar, önce denenecek:
  - Google MediaPipe Interactive Segmenter: dokunulan noktadan maske, ücretsiz, hafif (hazal’ı yormaz; tarayıcı/telefonda da çalışır).
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
Bugün: web TR/EN (dil uygulama içinde seçiliyor, adreste değil), admin TR, kullanıcıda `locale` alanı ve TR/EN sürümlü
yasal metin altyapısı var. Görsel talimatları İngilizce kalır (modelin en iyi anladığı dil); kullanıcı dili ayrı.
- [ ] Dil sırası önerisi: TR, EN (var) → DE (Almanya’daki Türkiye kökenli kitle, büyük dekorasyon pazarı) → AR (Körfez,
  iç mimarlık pazarı büyük; sağdan sola düzen gerekir) → RU → ES / FR / IT.
- [ ] Web: dile göre ayrı adresler (`/en`, `/de`), hreflang ve sitemap — arama motorlarında her dil ayrı görünsün.
- [ ] Backend: e-posta, push, stil/oda adları ve hata mesajları kullanıcının dilinde.
- [ ] AI sohbet ve alışveriş listesi kullanıcının dilinde; para birimi (TL, EUR, USD) ve mağaza bağlantıları ülkeye göre.
- [ ] Yasal metinler her dilde (KVKK + AB için GDPR); mağaza sayfaları ve ekran görüntüleri her dilde.
- [ ] Admin: TR içerikten diğer dilleri AI ile doldurma (maeyja `translation-fill` deseni), insan onayıyla yayın.
- [ ] Mobil dil seçimi (sen).

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
- [ ] Panelden toplu push/kampanya (pazarlama izni ayrımı, test gönderimi, teslim raporu) + yaşam döngüsü e-postaları ve
  geri çağırma (fal-app).
- [ ] Sonuç geri bildirimi (“beğendim / bana uymadı” + neden) → admin’de red oranı; model değerlendirmesini besler (palemi).
- [ ] Onboarding sorusu “Ev sahibi misin, mimar mı?” → Profesyonel katmana yönlendirme; A/B deneyleri (fal-app, palemi).
- [ ] Kurucu uyarıları: disk/DB/model emekliliği/kota, ödeme bildirimi, haftalık KPI e-postası (fal-app).
- [ ] Bekleme listesi + bülten (mağazalar açılmadan web ziyaretçisi), admin CMS (SSS, ana sayfa) (fal-app, maeyja).
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
- [ ] Codex için bağımsız test ve denetim komutu (en sonda).

## İşletim
- [ ] Mağazalar: Apple Developer, Google Play Console, RevenueCat ürünleri (`casalume_*`).
- [ ] Sunucu dışı yedek (şifreli), uptime izleyici, Sentry (AB bölgesi).
- [ ] hazal’a fail2ban (e-posta girişlerine kaba kuvvet denemeleri görülüyor).
- [ ] Admin ilk girişi: Google Authenticator kurulumu ve `admin-credentials.txt`’nin silinmesi (sahibi yapıyor).
- [ ] hazal’daki diğer siteler (bilgi): maeyja.com 503 veriyor (Casalume öncesinden); uzmanumre.com’da DKIM/DMARC yok.
