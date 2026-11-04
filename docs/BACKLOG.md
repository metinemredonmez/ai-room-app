# Casalume — iş listesi (4 Kasım 2026)

Hedef kitle: **herkes** — ev sahibi, kiracı, dekorasyon meraklısı **ve** mimar / iç mimar. Varsayılan deneyim basit
kalır; profesyonel ihtiyaçlar (proje, müşteri, sunum) PRO ve “Profesyonel” katmanında toplanır.

## Şu an
- [x] Dört renk teması (Kil · Pirinç · Mürekkep · Erik): web (başlıktaki seçici) ve admin (kullanıcı menüsü). Açık tema varsayılan.
- [ ] Web ana sayfası: gerçek fotoğraflar (Nano Banana 2 önce/sonra), Casalume logosu, görsel ağırlıklı bölümler.
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

## Admin
- [ ] Eski görünümdeki 8 ekranı yeni tasarıma taşı (Kullanıcılar + detay, Stiller, Ödeme olayları, AI maliyeti, Zamanlı işler, Denetim, Sistem, Ayarlar kısmen).
- [ ] Admin’e her yerden güvenli erişim: Tailscale (şimdilik yalnız sahibin ev IP’si açık).

## Belgeler
- [ ] Masaüstündeki diğer uygulamalarla (yoga, fal-app, palemi, maeyja, …) özellik karşılaştırması.
- [ ] `Casalume-API-ve-Hesaplar.pdf`: kullanılan teknolojiler, bildirimler, diğer uygulamalardan alınacaklar.
- [ ] Codex için bağımsız test ve denetim komutu (en sonda).

## İşletim
- [ ] Mağazalar: Apple Developer, Google Play Console, RevenueCat ürünleri (`casalume_*`).
- [ ] Sunucu dışı yedek (şifreli), uptime izleyici, Sentry (AB bölgesi).
- [ ] hazal’a fail2ban (e-posta girişlerine kaba kuvvet denemeleri görülüyor).
