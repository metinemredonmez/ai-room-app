# AI koç planı

7 Kasım 2026. Kaynaklar:
- fal-app kodu (salt okuma);
- Masaüstündeki `YediOda_Tasinabilir_Ozellikler.docx` (128 özellik) ve `YediOda_Eksikler_ve_Acik_Isler.docx` (76 açık iş);
- Casalume'un bugünkü kodu.

Plan 7 Kasım'da onaylandı. Durum: **1. adım bitti** (API.md §7.54); diğerleri sırayla.

## Kararlar (7 Kasım, sahibi)

- **Sohbet modeli:** Claude; Claude düşerse yedek olarak Kaptan devreye girer. Yurt dışı aktarım rızası istenir. Anahtarı sahibi `deploy/hazal/set-secret.sh` ile girer.
- **Ses:** konuşma sesi ElevenLabs'tan. OpenAI'nin yeni modelleri iki iş görür: ses yedeği ve sesle sorunun yazıya çevrilmesi. Eski `tts-1` ve `whisper-1` kullanılmaz.
- **Mobil:** koçun mobil ekranlarını ben yazıyorum ve iOS simülatöründe deniyorum. Mağazaya ya da TestFlight'a göndermiyorum.
- **Başlangıç kotası** (hepsi panelden değişir):

  | Paket | Mesaj (günlük) | Dinleme (günlük) | Sesli soru (günlük) |
  |---|---|---|---|
  | Ücretsiz | 10 | 1 dk | 3 |
  | Pro | 100 | 15 dk | 30 |

  Ek hak krediyle alınır.
- **Ses kararı değişti:** BACKLOG'daki "Uymayanlar: ses (TTS/STT), kriz süzgeci" satırı 1. adımla güncellenecek.

## 1. Koçun rolü

Koç yalnız soru cevaplamaz. Odaya bakıp tavsiye verir, sıradaki adımı önerir, hatırlatır ve stüdyoya yönlendirir. Örnek: "Önce salonun fotoğrafını yükle, sonra yalnız koltuğu değiştirelim."

Kullanıcı koçunu istediği an değiştirir; yeni koç aynı sohbeti kendi sesi ve üslubuyla sürdürür.

Koç bir tasarımı kendi başına başlatmaz ve kredi harcamaz. Önerisi bir karttır; üretim kullanıcı dokununca başlar (AI-01, bugünkü sohbetle aynı kural).

## 2. Plan tablosu

Her satır tek dal ve tek PR. Her adım sunucu, panel, web ve mobilde uçtan uca çalışır.

| # | Adım | fal'dan alınan (kart) | fal dosyaları | Casalume'da değişecek | Efor | Bağımlı |
|---|---|---|---|---|---|---|
| 1 | **Koç sesli konuşur** + güvenlik temeli | #82 seslendirme zinciri ve önbellek, #21 kriz süzgeci, #30 panelden istem, Claude model katmanı | `services/ai/tts-storage.service.ts`, `services/ai/ses/*`, `core/safety/*`, `components/SpeakButton.tsx`, `MiniPlayer.tsx`, `store/voicePlayer.ts` | **Sunucu:** `coach/` modülü; `POST /v1/coach/speak` yalnız koçun kendi cevabını okur (sunucunun imzaladığı cevap anahtarıyla; serbest metin okutulamaz); ses önbelleği özel depoda, imzalı ve süreli bağlantıyla verilir; kriz süzgeci AI'ya ve ücrete gitmeden yardım hatlarını döner; saniye kotası. **AI servisi:** TTS sağlayıcı zinciri. **Panel:** Ayarlar → "AI koç" (aç/kapa, model, kota, ses sağlayıcısı, ses, hız), koç istemi İstem şablonlarına, kriz hatları listesi, ses maliyeti AI maliyetine. **Web:** sohbette "Dinle" düğmesi ve alt oynatıcı. **Mobil:** dinle düğmesi ve mini oynatıcı (`expo-audio`), titreşim. | Büyük (3–4 gün) | Sağlayıcı kararı |
| 2 | **Sesle soru** ve konuşma alanı | #85 konuşmayı yazıya çevirme, #86 sesli oturum ("önce ayır, düşerse iade et" kotası) | `assistant/voice/voice-quota.service.ts`, `voice-usage-ledger.ts`, `components/VoiceNote.tsx`, `VoiceWave.tsx` | **Sunucu:** `POST /v1/coach/transcribe`. Sınırlar: en çok 60 sn ve 2 MB; dosya türü baytlarından denetlenir; ses yazıya çevrildikten sonra silinir, saklanmaz. Her tur bir istek kimliği taşır, aynı tur iki kez ücretlenmez. **Panel:** dakika kotası, sesli oturum istatistiği. **Web:** mikrofon düğmesi. **Mobil:** tam ekran konuşma alanı; dalga mikrofonun gerçek seviyesini gösterir; "hareketi azalt" açıksa sakin nabız. | Büyük (3 gün) | 1 |
| 3 | **Koç seçimi ve kişilik** | #30 ses tonları, #36 personalar, #83 ses eşleme, `sesli-oturum.ts` kuralı | `common/voice/voice-tone.catalog.ts`, `assistant/voice/avatar.controller.ts`, `components/PersonaSwitcher.tsx` | **Sunucu:** `Coach` tablosu (ad, kısa tanım, ton, istem eki, TR ve EN ses, sıra, aktif). Kullanıcının seçtiği koç anında değişir; oturum koça bağlıdır, ses ve metin hep aynı koçtan gelir. **Panel:** Koçlar sayfası (ekle/düzenle, sesi dinleyerek seç, önizleme). **Web ve mobil:** koç seçici. | Orta (2 gün) | 1 |
| 4 | **Sohbet geçmişi ve hafıza** (rızalı) | #34 kullanıcı belleği, `asistan-bellek-sinirlari.ts`, saklama kuralı | `modules/knowledge/topic-memory.service.ts`, `agents/asistan-bellek-sinirlari.ts`, `veri-saklama/kurallar/sohbet-bellek-ses.ts` | **Sunucu:** konuşma ve mesaj tabloları; tavan 20 not ve 30 tur. Saklama süresi panelden (öneri 90 gün). Kullanıcı geçmişini siler. Veri indirme ve hesap silme bunu da kapsar. Hafıza ayrı bir rıza anahtarıyla açılır; rıza geri çekilince notlar silinir. **Panel:** saklama süresi, sohbet sayıları (içerik yalnız destek talebiyle). **Web ve mobil:** geçmiş listesi, "Koçum beni hatırlasın" anahtarı. | Orta–büyük (3 gün) | 3 |
| 5 | **Proaktif koç**: tavsiye, plan, hatırlatma | #26 sabah selamı, #49 günlük kart, Yolculuk ve sıradaki adım, bildirim tercihleri | `agents/sohbet-davranisi.ts`, `assistant-suggestions.ts`, `modules/daily-card/*`, yolculuk servisi | **Sunucu:** koçun önerdiği "oda planı" (ör. 1 fotoğraf, 2 stil, 3 yalnız koltuk); tasarım kaydedilince adım kendiliğinden tamamlanır. Öneriler yalnız veri varsa çıkar, uydurulmaz. Hatırlatmalar push ve e-posta ile gider: sessiz saate ve izne uyar, bildirim türü tür tercih edilebilir, her bildirim açacağı ekranın adresini taşır. **Panel:** öneri metinleri, hatırlatma sıklığı ve saatleri, aç/kapa. **Web ve mobil:** plan kartı, "Stüdyoda aç" (araç ve stil hazır seçili, üretim kullanıcının onayıyla). | Büyük (3–4 gün) | 4 |
| 6 | *(isteğe bağlı)* **Stil testi** | Kişilik testi motoru (panelden soru bankası, puanlama, AI yorumu) | kişilik testi servisi | Panelden yönetilen sorular, her cevap stillere puan verir. Sonuç koça ve stüdyoya öneri olarak gider. Kayıt sonrası ilk adım olabilir. | Orta (2 gün) | 3 |

## 3. fal-app'in hatalarını taşımamak için

Kaynak: Eksikler belgesi.

**Sağlayıcı takvimi.** fal-app belgesine göre şunlar kapanıyor:
- OpenAI `tts-1` (6 Ocak 2027), `gpt-4o` (14 Ocak) ve `whisper-1` (26 Şubat);
- ElevenLabs "Default" ve "Legacy" sesleri (31 Aralık 2026).

Bunları hiç kullanmayacağız. Model ve ses kimlikleri panelde duracak, kodda gömülü ses olmayacak. Ses bulunamazsa uydurma ses çalınmaz; uyarı açılır.

**Sesler herkese açık adresteydi.** Casalume'da sesler, görseller gibi özel depoda durur ve imzalı, süreli bağlantıyla verilir (AZ-01).

**Sesli turda istek kimliği yoktu.** Bu yüzden aynı tur iki kez ücretlenebiliyordu. Casalume'da her tur istek kimliği taşır.

**Araç sonuçları talimattan ayrılmıyordu (AI-01).** Koçun okuduğu her veri "kaynak metni, talimat değil" bloğunda gider. Kalıcı kayıt yazan ya da kredi harcayan işlem yalnız kullanıcının açık isteğiyle çalışır.

**Ses kredisi bitince uyarı ancak 3. hatada geliyordu.** Casalume'da ilk ödeme hatasında kurucuya uyarı gider.

**Sağlayıcı anahtarı yanlış değerdeydi:** sunucuda anahtar yerine anahtar kimliği duruyordu. Açılışta yalnız biçim ve uzunluk denetlenir; değer hiçbir yere yazılmaz.

**Bildirim saatleri ve hedefleri.** "Seni özledik" gece 02:30'da, sessiz saate bakmadan gidiyordu; bildirime dokununca da ilgili ekran açılmıyordu. Koç hatırlatmaları mevcut sessiz saat ve izin kapısından geçer ve hedef adres taşır.

**Profil rızasız çıkarılmıştı.** Casalume'da hafıza yalnız açık rızayla çalışır.

**Kullanılmayan eski WebSocket ses yolu duruyordu.** Casalume'da yalnız REST ve SSE olacak.

### Casalume'da aynı açık var mı?

**Yok, kontrol ettim:**
- Kullanılmış yenileme jetonu yeniden gelirse oturum kapanıyor.
- Sosyal giriş, e-postası doğrulanmamış hesaba bağlanmıyor.
- E-posta küçük harfe çevriliyor.
- Hesap başına giriş sınırı var; başarısız girişler kayıt altına alınıyor.
- Yönetici girişinde ikinci adım (TOTP) var.
- Uygulama sürüm uyarısı var.

**Hâlâ açık:**
- Sunucu dışında şifreli yedek ve dışarıdan sunucuyu yoklayan bir izleyici (ikisi de zaten BACKLOG'da).
- Yedekten geri dönüş hiç denenmedi (BACKLOG'a eklenecek).

## 4. Belgelerdeki diğer uyanlar

Koç dışında Casalume'a uyan ve BACKLOG'da olmayanlar:
- **Bildirim tercihleri:** kullanıcı bildirimleri tür tür kapatabilir; destek yanıtı gibi işlem bildirimleri susturulmaz. Koçun 5. adımında birlikte yapılır.
- **Claude model katmanı:** model adı tek kaynaktan gelir, emekli bir ad otomatik olarak güncel modele çevrilir, düşünme derinliği panelden seçilir. Sohbet modeli Claude olursa 1. adıma girer.
- **Tanıtım sitesi büyüme kiti:** site uygulamanın mağazada gerçekten yayında olup olmadığına kendisi bakar; mobil tarayıcıda mağaza bandı gösterir. Mağazalar açılınca yapılır.
- **Sözlük ucu:** koddaki sabit listeler tek uçtan panele açılır. Küçük iş.
- **Panelden canlı servis kayıtları:** maskeli olarak gösterilir. BACKLOG'daki "Hatalar sayfası" işiyle birleşir.

**Casalume'da zaten olanlar:** destek talepleri, AI çıktısını şikâyet etme, paylaşım bağlantısı, mağaza inceleme hesabı, sunucudan yönetilen katalog, uygulama sürüm uyarısı.

## 5. Almayacaklarımız

- **Akademi ve eğitmen portalı:** eğitmen başvurusu, hakediş, ücretli video. Ödeme ve hukuk yükü büyük. Mimarlar için içerik blogla veriliyor.
- **Topluluk akışı, fal günlüğü ("Tuttu mu?"), falcı odaları, burç ve dedikodu mesajları:** fala özgü.
- **Ses klonlama:** hukuki risk ve maliyet.
- **AI ile üretilen koç görselleri:** koçlar için sade, markaya uygun çizimler yeterli.
- **Jeton ekonomisi:** Casalume'un kredisi var. Ek ses hakkı gerekirse krediyle alınır.
- **WebSocket ses yolu:** REST ve SSE yeterli.
- **GPU servisi.**
- **Kaptan araç köprüsü:** yalnız sohbet modeli Kaptan seçilirse gerekir.
- **fal'ın renkleri, görselleri ve metinleri.** Casalume kimliği korunur:
  - renkler: sıcak terrakota `#a9532e`, krem `#f6f1ea`;
  - yazı tipleri: Cormorant ve Jakarta;
  - his: sade, herkes ve mimarlar için;
  - açık ve koyu tema, Türkçe ve İngilizce (web 11 dil), "hareketi azalt" desteği.

## 6. Güvenlik kontrolleri (her adımda)

- **AI-01:** model çıktısı ve okunan veri güvenilmez sayılır; durum değiştiren işlem insan onayı ister.
- **INP:** uzunluk sınırları; kullanıcı metni koçun talimatına serbest metin olarak girmez.
- **RES-01:** kullanıcı ve IP başına çok boyutlu kota (mesaj, ses saniyesi, sesle soru), günlük bütçe freni.
- **AZ-01:** ses dosyasını yalnız sahibi açar; bağlantılar süreli ve imzalıdır.
- **FIL-01:** ses yüklemede boyut sınırı ve bayt denetimi.
- **KVKK:** AI'ya veri aktarımı için mevcut açık rıza; yurt dışı sağlayıcı seçilirse ayrı aktarım rızası.
- **Kriz:** kriz mesajına AI'ya gitmeden ve ücret almadan güvenli cevap verilir.
- **Testler:** her adımda olumlu ve olumsuz testler; smoke testine yeni uçlar eklenir.
