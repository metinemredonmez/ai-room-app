# AI koç görevi: inceleme notları (7 Kasım 2026)

**Görev:** fal-app'teki AI koç/asistan yapısı Casalume'a uyarlanacak. İlk adım koçun sesli konuşması.

**Durum:** 1. adım bitti ve canlıda (PR #1). Kalan adımlar ve kurallar: `docs/KOC-DEVAM-PROMPTU.md`.

## Nerede kaldım
1. fal-app incelemesi (salt okuma): **bitti**, aşağıda.
2. Casalume'un bugünkü hali: **büyük kısmı bitti**, aşağıda.
3. Plan tablosu, sıralama, almayacaklarımız ve sorular: **yazıldı** → `docs/KOC-PLANI.md` (kararlar dahil). Sıradaki iş: onay gelince 1. adım (koç sesli konuşur), ayrı dalda.

---

## 1. fal-app (`/Users/emre/Desktop/fal-app`)

### Sunucu: uçlar

**Yazılı asistan:** `apps/backend/src/modules/assistant/assistant.controller.ts`.
- `POST /assistant/ask` ve `ask/stream` (SSE), `from-room/:roomKey/ask`.
- `GET suggestions | quota | history | notes | preferences`, `PATCH preferences`.
- `POST morning/preview` ve `gossip/preview`.
- Admin: `admin/assistant/{morning|gossip}/run`, `send/:userId`, `messages`, `stats`.

**Sesli sohbet:** `apps/backend/src/modules/assistant/voice/voice-chat.controller.ts` + `voice-chat.service.ts` (1839 satır).
- `GET read-aloud | quota | sessions | session/:id | avatars`.
- `POST session/start`, `session/:id/transcribe`, `session/:id/turn`, `session/:id/end`, `speak`.
- Admin: `sessions`, `stats`.
- Akış: oturum açılır, ses S3'e yüklenir, STT, ajana sorulur, TTS, tur DB'ye yazılır.

**Ses önizleme ve tonlar:** `apps/backend/src/modules/assistant/voice/voice-preview.controller.ts`.
- `GET /voice/tones`, `/voice/personas`, `/voice/persona-image`, `/voice/preview/:tone`, `/voice/persona-preview/:id`.
- Bunlara throttle uygulanıyor.

**Admin avatar ve persona:** `apps/backend/src/modules/assistant/voice/avatar.controller.ts`.
- `admin/assistant/avatars`: CRUD, toggle, set-default, english-copy, yedek-sesler, görsel yeniden üretimi.

**Ses klonlama (SUPER_ADMIN):** `apps/backend/src/modules/voice-cloning/voice-cloning.controller.ts`.

**Socket sohbet:** `apps/backend/src/modules/chat/chat.gateway.ts`, `/chat` namespace.
- Olaylar: `voice.transcribe`, `voice.speak`, `voice.message`.

### Sunucu: kota

**Sesli kota:** `apps/backend/src/modules/assistant/voice/voice-quota.service.ts` + `voice-usage-ledger.ts`.
- Günlük haklar panelden gelir.
- Defter PostgreSQL'de, tek transaction'da tutulur.
- Süre rezervasyonla düşülür: `reserveTurn`, `settle`, `release`; kira süresi 15 dk.
- Ek dakika jetonla alınır.

**Yazılı kota:** `apps/backend/src/modules/assistant/assistant-quota.service.ts`.
- Hak bitince gösterilecek metin panelden gelir (`assistant.hak_bitti_metni`).

### Sunucu: kişilik, davranış, hafıza

**Ton kataloğu:** `apps/backend/src/common/voice/voice-tone.catalog.ts`.
- Tek liste, Prisma enum'undan türetilir, `GET /voice/tones` ile dışa açılır.
- Persona metinleri ayrı dosyada: `services/ai/prompts/voice-tones.ts`.

**Davranış:** `apps/backend/src/agents/sohbet-davranisi.ts`.
- Niyet ayrımı: selamlaşma / belirsiz / konu.
- Yönlendirme sıklığı panelden ayarlanır (`assistant.sohbet_davranisi`).

**Hafıza tavanları:** `apps/backend/src/agents/asistan-bellek-sinirlari.ts`.
- 20 not, 30 tur; yazarken de aynı tavanda kırpılır.
- Saklama kuralı: `modules/veri-saklama/kurallar/sohbet-bellek-ses.ts`.

**Başlangıç önerileri:** `apps/backend/src/modules/assistant/assistant-suggestions.ts`.
- Her önerinin bir veri şartı var; şart yoksa öneri çıkmaz (uydurma yok).
- Metinler panelden: `assistant.chat_suggestions`.

**Ajan:** `apps/backend/src/agents/assistant.agent.ts` (3734 satır, fal'a özgü).
- Model ayarları: `agents/claude-ajan.ts`, efor panelden (`ai.claude_efor`).

### Sunucu: kriz ve ses ayarları

**Kriz:** `apps/backend/src/core/safety/`.
- `kriz-kapisi.guard.ts` global ve hiçbir isteği engellemez, yalnız işaretler.
- `kriz-kisa-devre.interceptor.ts` kriz varsa ücret ve kota düşmeden önce sabit güvenli cevap döner.
- Telefon numaraları `kriz-hatlari.ts`'te; çok sayıda test var.

**Panelden yönetilen ses ayarları (SystemConfig):**
- `ses.uretim_modeli`, `ses.kararlilik`, `ses.ifade`
- `ses.duraklama_cumle_ms`, `ses.duraklama_paragraf_ms`
- `ses.onbellek_surumu`
- Önbellek denetimi: `apps/backend/scripts/tts-cache-audit.cjs`.

### AI servisi
- TTS: `apps/ai-service/services/tts_service.py`. Sıra ElevenLabs, sonra OpenAI, sonra Python.
- STT: `apps/ai-service/services/stt_service.py`. Önce Whisper, olmazsa OpenAI Whisper.

### Ortam değişkenleri (yalnız adları)
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`
- `STORAGE_URL`, `AWS_*`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `TTS_STORAGE_PREFIX`
- `GPU_SERVICE_URL`, `GPU_SERVICE_TOKEN`
- `API_URL`, `API_PUBLIC_URL`

**Dikkat:** fal'da sesler herkese açık bir depolama adresinden servis ediliyor. Casalume'da görsellerdeki gibi süreli, imzalı bağlantı olmalı.

### Panel (`apps/admin/src/app/(admin)/`)
| Sayfa | Çağırdığı uçlar |
|---|---|
| `assistant/page.tsx` | `/admin/assistant/messages`, `stats`, `{kind}/run`, `send` |
| `assistant/voice/page.tsx` + `[id]` | sesli oturumlar ve istatistik |
| `assistant/avatars/page.tsx` | persona, ses ve görsel yönetimi |
| `voice-settings/page.tsx` | ses sağlığı, abonelik, eşleme, önizleme |
| `voice-cloning/page.tsx` | ses klonlama |
| `ai/prompts`, `ai/cost`, `ai/fallback-chain`, `ai/runs` | istem, maliyet ve yedek sağlayıcı zinciri |
| `chat/page.tsx` | sohbet oturumları |

### Mobil (`apps/mobile/`)
- **Sohbet ekranı:** `app/(tabs)/chat.tsx` (2822 satır). Ses kaydı `expo-audio`, titreşim `expo-haptics`.
- **Koç seçimi:** `components/PersonaSwitcher.tsx` ve `PersonaAvatar`. Onboarding'de ton seçimi `app/(onboarding)/voice-tone.tsx`.
- **Ses dalgası:** `components/VoiceWave.tsx`. Mikrofonun gerçek seviyesini (metering) gösterir, sahte dalga yok; seviye okunamazsa sakin bir nabız.
- **Sesli mesaj ve sesli okuma:** `VoiceNote.tsx`, `ReadAloud.tsx` (`ReadAloudBar`, `SpokenText`), `SpeakButton.tsx`.
- **Sohbet dışındaki konuşma alanı:** `components/MiniPlayer.tsx` + `src/store/voicePlayer.ts`. Zustand ile global oynatıcı; ekran değişse de ses sürer.
- **Oturum kuralı:** `src/services/sesli-oturum.ts`. Oturum, açıldığı personaya bağlanır; persona değişince yeni oturum açılır (ders: ses ve metin farklı kişiden geliyordu).
- **Animasyon:** `components/Constellation.tsx`.
- **Kriz düğmeleri:** `components/KrizHatlari.tsx`.
- **Durum bileşenleri:** `ErrorState`, `SkeletonLoader`, `NotificationsEmpty`.
- **"Hareketi azalt":** bazı bileşenlerde var (ör. `MysticAlert`, `gelenek/*`).
- **Tasarım:** NativeWind ile `tailwind.config.js`. Koyu mor ve altın tonları fal'a özgü, **alınmayacak**.

---

## 2. Casalume bugün

### Sunucu
**Uç:** `POST /v1/chat`, `apps/backend/src/app.controller.ts` (~satır 506).
- Durumsuz: istemci son 20 mesajı gönderir, mesaj başına en çok 2000 karakter, en çok 3 görsel.
- Bayrak `assistant_chat` ile açılıp kapanır.
- Sınırlar: kullanıcı başına 40/saat, IP başına 150/saat (`apps/backend/src/common/infra.ts`). Bunlar kodda sabit, panelde yok.
- Görsel varsa AI onayı istenir; bütçe kontrolü var.
- Öneriler veri olarak döner; kullanıcı dokunmadan üretim başlamaz (AI-01).

**AI servisi:** `apps/ai-service/app/assistant.py`, Claude.
- Sohbet istemi kodda (`system=`), panelden yönetilmiyor.
- `chat_enabled` yalnız `ANTHROPIC_API_KEY` varsa açık. Canlıda sohbet "kullanılamıyor".

**Yok:** sohbet geçmişi, hafıza, ses (TTS/STT), persona, proaktif mesaj, kriz süzgeci.

### Panel
- **Var:** özellik bayrakları, istem şablonları (§7.26, yalnız görsel üretimi), AI motoru (§7.27, görsel sağlayıcı), AI maliyeti.
- **Yok:** sohbet istemi, sohbet modeli, sohbet kotası, koç/persona, ses.

### Mobil
- Sohbet ekranı `apps/mobile/src/app/chat.tsx` (245 satır), API istemcisi `src/lib/api.ts`, tema `src/constants/theme.ts`.
- `expo-haptics` ve `expo-notifications` kurulu. `expo-audio` yok.

### Web
- Sohbet sayfası `apps/web/src/app/[locale]/sohbet/chat.tsx`.

### Sunucuda hazır, mobile bağlanmamış
BACKLOG'daki "(sen)" maddeleri:
- dokun-seç, galeri izni kutusu, KVKK başvurusu ve veri indirme;
- destek ekranı, ödeme ekranı, deneme süresi ve paywall;
- yayın açılma bildirimi (`POST /v1/broadcasts/:id/opened`), istemci hata ucu, kredi hareketleri;
- Google/Apple ile giriş, tema (`GET /v1/theme`), haptik.

---

## Plana girecek kararlar ve çelişkiler

**Çelişkiler**
- BACKLOG'da "Uymayanlar: ses (TTS/STT), kriz süzgeci" yazıyor; bu görev sesi istiyor. Kararın değiştiğini sahibine teyit ettir.
- Hafızadaki kural "mobil senin" diyor; bu görev mobil kodu ve simülatörde denemeyi istiyor. Mobili kimin yazacağını sor.
- Görevdeki "proje kimliği" alanı boş bırakılmış. Mevcut kimliği öner: sıcak terrakota `#a9532e`, krem `#f6f1ea`, Cormorant ve Jakarta yazı tipleri, minimal; herkes ve mimarlar için.
- "Sağlık bilgisi" Casalume'a uymuyor. Yine de sohbetteki serbest metin kişisel veri sayılır; saklama süresi ve silme hakkı olmalı.

**Sahibine sorulacaklar**
- **Sohbet modeli:** Claude (yurt dışı aktarım onayı gerekir) mi, Kaptan (Türkiye'de) mı?
- **Ses sağlayıcısı:** TTS için ElevenLabs, OpenAI, Google ya da Azure; STT için Whisper ya da Google. Hepsi yurt dışına aktarım demek, KVKK açık rızası gerekir.
- **Ücret:** ücretsiz / ücretli ayrımı ve kota (günlük mesaj, sesli dakika); ek hak kredi ile alınabilsin mi?
- **Koçlar:** kaç koç olacak, kişilikleri ve sesleri ne?

**Taslak adım sırası** (her adım tek PR, uçtan uca)
1. **Koç sesli konuşur.**
   - Kriz ve güvenlik temeli de bu adımda.
   - TTS yalnız koçun kendi cevabını okur (cevap kimliğiyle), serbest metin okutulamaz.
   - Ses önbelleği; sesler imzalı, süreli bağlantıyla verilir.
   - Saniye kotası; panelde koç ve ses ayarları; mobil ve web'de oynat düğmesi ve mini oynatıcı.
2. **Sesle soru (STT):** konuşma alanı, gerçek seviyeli dalga.
3. **Koç seçimi ve kişilik:** kullanıcı istediği an değiştirir; oturum personaya bağlı.
4. **Sohbet geçmişi ve hafıza:** tavanlar, saklama süresi, kullanıcı silebilir.
5. **Proaktif koç:** veri şartlı öneriler, hatırlatma (uygulama içi, push, e-posta), araca tek dokunuşla yönlendirme (AI-01).

**Alınmayacaklar**
- Falcı ve oda kavramları, dedikodu ve burç mesajları.
- Ses klonlama: hukuki risk ve maliyet.
- AI ile üretilen persona görselleri.
- Jeton ekonomisi: Casalume'un kredisi var.
- WebSocket: REST ve SSE yeterli.
- "Başka falcı anlatsın", akademi, RunPod kriz modeli.
- fal'ın renkleri, görselleri ve metinleri.

**Güvenlik kontrolleri:**
- AI-01: model çıktısı ve araçlar güvenilmez sayılır; durum değiştiren işlem insan onayı ister.
- RES-01: çok boyutlu kota.
- AZ-01: ses dosyalarına sahip kontrolü.
- INP: uzunluk sınırı; kullanıcı metni koçun talimatına girmez.
