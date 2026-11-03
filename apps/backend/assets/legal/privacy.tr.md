# KVKK Aydınlatma Metni

Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu'nun ("KVKK") 10. maddesi uyarınca, AI Room uygulamasını ve
web sitesini kullanırken kişisel verilerinin nasıl işlendiğini açıklar.

## 1. Veri sorumlusu

{{controller.name}}
Adres: {{controller.address}}
E-posta: {{controller.email}}
KEP: {{controller.kep}}

## 2. Hangi verileri işliyoruz?

- **Kimlik ve iletişim:** ad (verirsen), e-posta adresi, Apple veya Google ile giriş yaptıysan bu hesapların bize ilettiği
  kimlik ve e-posta bilgisi.
- **Görsel:** yüklediğin oda, bina veya bahçe fotoğrafları ve bunlardan üretilen tasarımlar. Fotoğraftaki konum ve cihaz
  bilgileri (EXIF) sunucuya ulaştığında silinir. Lütfen fotoğraflarında kişilerin yer almamasına dikkat et.
- **Müşteri işlem:** tasarım geçmişi, kullandığın araçlar ve stiller, kredi hareketleri, abonelik durumu, sohbet
  asistanına yazdıkların.
- **İşlem güvenliği:** IP adresi, cihaz için üretilen tek yönlü özet (cihaz kimliğinin kendisi saklanmaz), oturum kayıtları,
  bildirim (push) token'ı, güvenlik ve hata kayıtları.
- **Pazarlama:** yalnız açık rıza verirsen, kampanya ve yenilik bildirimleri için iletişim tercihlerin.

## 3. Amaçlar ve hukuki sebepler

| Amaç | Hukuki sebep (KVKK m.5/2) |
|---|---|
| Hesabını oluşturmak, tasarım üretmek, aboneliğini ve kredilerini yönetmek | Sözleşmenin kurulması ve ifası (c) |
| Fotoğraflarını yapay zekâ sağlayıcılarında işleyerek tasarım üretmek | Sözleşmenin ifası (c); yurt dışına aktarım için m.9 (aşağıda) |
| Hesap güvenliği, kötüye kullanımın ve dolandırıcılığın önlenmesi, hata takibi | Meşru menfaat (f) |
| Yasal saklama ve bildirim yükümlülükleri, resmî makam talepleri | Hukuki yükümlülük (ç) |
| Kampanya ve yenilik iletileri | Açık rıza (m.5/1) |

## 4. Kimlere aktarıyoruz?

Verilerini yalnız hizmeti sunmak için gereken ölçüde, aşağıdaki hizmet sağlayıcılarla paylaşırız:

- **Yapay zekâ sağlayıcıları** (ör. Google Gemini, fal.ai, Anthropic): fotoğraf, tasarım talimatı ve sohbet mesajı; yalnız
  tasarım ve öneri üretmek için.
- **Barındırma ve depolama** (sunucu ve nesne depolama hizmeti).
- **Ödeme ve abonelik:** Apple App Store, Google Play ve abonelik altyapısı (RevenueCat). Kart bilgilerini biz görmeyiz.
- **Bildirim ve e-posta:** Expo bildirim servisi ve e-posta gönderim hizmeti.
- **Hata takibi:** hata raporları; bu raporlara kişisel veri eklenmez.
- **Yetkili kamu kurum ve kuruluşları:** yalnız hukuki yükümlülük bulunduğunda.

Bu sağlayıcıların bir kısmı yurt dışında bulunur. Yurt dışına aktarım KVKK m.9'da öngörülen uygun güvencelerle (standart
sözleşme) ya da yapay zekâ işleme metniyle verdiğin açık rızaya dayanılarak yapılır.

## 5. Toplama yöntemi

Veriler; uygulama ve web sitesi üzerinden senin girdiğin bilgilerle, Apple/Google ile girişte bu hizmetlerden, uygulama
mağazalarından ve hizmeti kullanırken otomatik olarak (sunucu kayıtları) elektronik ortamda toplanır.

## 6. Saklama süreleri

- Bir tasarıma bağlanmayan yüklemeler 7 gün sonra silinir.
- Tasarımların sen silene ya da hesabını silene kadar saklanır.
- Hesabını sildiğinde hesabına bağlı veriler silinir; Apple ile girişte Apple'daki izin de iptal edilir.
- Mevzuatın saklamamızı zorunlu kıldığı kayıtlar ilgili süre boyunca saklanır.
- KVKK başvuru kayıtları, başvurunun nasıl sonuçlandırıldığını kanıtlamak için kapanıştan sonra 2 yıl saklanır.

## 7. Haklarınız (KVKK m.11)

Veri sorumlusuna başvurarak:

- kişisel verilerinin işlenip işlenmediğini öğrenme ve işlenmişse bilgi talep etme,
- işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,
- yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,
- eksik veya yanlış işlenmişse düzeltilmesini isteme,
- KVKK m.7 çerçevesinde silinmesini veya yok edilmesini isteme,
- düzeltme ve silme işlemlerinin aktarıldığı üçüncü kişilere bildirilmesini isteme,
- münhasıran otomatik sistemlerle analiz edilmesi sonucu aleyhine bir sonuç çıkmasına itiraz etme,
- kanuna aykırı işlenmesi sebebiyle zarara uğramışsan zararın giderilmesini talep etme

haklarına sahipsin.

## 8. Nasıl başvurursun?

- Uygulamada **Profil → Gizlilik → KVKK başvurusu** ekranından (hesabınla doğrulanmış başvuru),
- kayıtlı e-posta adresinden {{controller.email}} adresine,
- KEP ile {{controller.kep}} adresine,
- ya da yazılı olarak {{controller.address}} adresine.

Başvurun en geç **30 gün** içinde ücretsiz olarak sonuçlandırılır. İşlem ayrıca bir maliyet gerektirirse Kişisel Verileri
Koruma Kurulu'nca belirlenen tarifedeki ücret alınabilir. Verilerinin tamamını uygulamadaki **Verilerimi indir** seçeneğiyle
de alabilirsin.
