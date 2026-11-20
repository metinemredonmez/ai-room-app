# Görev: Casalume AI koç — kalan adımlar (devam istemi)

> Hatırlatma: bu istem 8 Kasım 2026'da yazıldı; yeni bir oturuma olduğu gibi yapıştırılır.
> - Sonrasında `bitirme/19-kasim` dalında (PR #5) başka işler yapıldı: çerez bandı, paylaşım sayfası, hesap güvenliği,
>   30 günlük silme penceresi, Runware yedeği. Önce `git log --oneline -15 --all` ve açık PR'lara bak.
> - Canlı anahtarlar (ElevenLabs, OpenAI, Anthropic) 8 Kasım'da sunucuya girildi ve AI servisi bunlarla yeniden başlatıldı.
>   Claude sohbeti açık; iki ses sağlayıcısı hazır.

Sen Casalume monoreposunda çalışıyorsun: /Users/emre/Desktop/casalume (GitHub metinemredonmez/ai-room-app, public).

**Katmanlar:**
- apps/backend: NestJS, Prisma 7, PostgreSQL, Redis ve BullMQ.
- apps/ai-service: FastAPI.
- apps/admin: Next.js 16 panel.
- apps/web: Next.js 16, 11 dil.
- apps/mobile: Expo SDK 58.

**Canlı:** paylaşılan sunucu "hazal". Adresler: casalume.app, api.casalume.app, admin.casalume.app.

**Ana hedef:** "her şey panelden". Her özellik admin panelinden yönetilebilmeli.

## Önce oku (kod yazmadan)
- CLAUDE.md, AGENTS.md, environments/AGENTS.md, apps/mobile/AGENTS.md. Expo kuralı: API'leri hafızadan değil, SDK 58 belgesinden yaz.
- docs/KOC-PLANI.md: onaylı plan, sahibinin kararları, alınmayacaklar, fal-app'ten çıkan dersler.
- docs/API.md §7.54 (koç), §7.26 (istem şablonları), §7.27 (AI motoru), §7.41 (uyarılar).
- docs/BACKLOG.md → "AI koç" bölümü.
- docs/KOC-INCELEME-NOTLARI.md: fal-app'in koç yapısı, dosya yollarıyla.
- Örnek uygulama /Users/emre/Desktop/fal-app. Yalnız okunur, hiçbir dosyasını değiştirme.
  - Masaüstündeki YediOda_Tasinabilir_Ozellikler.docx: fal-app'in 128 taşınabilir özelliği.
  - Masaüstündeki YediOda_Eksikler_ve_Acik_Isler.docx: fal-app'in hataları; bunları taşıma.

## Biten: 1. adım (PR #1, commit 4e325e8, canlıda)
- **Sunucu:** apps/backend/src/coach/ altında coach.rules.ts, coach.service.ts, coach.controller.ts.
  - POST /v1/chat artık şunları yapıyor:
    - kriz süzgeci: AI'ya gitmeden ve hak düşmeden 112 ve ALO 183 hatlarını döner;
    - günlük mesaj hakkı (Redis): ücretsiz 10, Pro 100; cevap gelmezse hak iade edilir;
    - cevapta speakToken: kullanıcı, dil ve metin üzerinde HMAC, 24 saat geçerli.
  - POST /v1/coach/speak: yalnız koçun kendi cevabını okur. Dinleme hakkı ücretsizde 60 sn, Pro'da 900 sn.
  - GET /v1/coach/audio/{key}: imzalı, yaklaşık 1 saat geçerli, Range destekli.
  - CoachAudio önbellek tablosu; gece saklama işi eski sesleri siler.
  - Sağlayıcıda ödeme, anahtar veya ses hatası olursa ilk olayda kurucuya uyarı (CoachVoiceProblem).
- **Ayarlar:** SettingsSchema.coach: voice (sağlayıcı sırası, ElevenLabs ve OpenAI sesleri, önbellek süresi), quota, limitText, crisis.
- **AI servisi** (app/voice.py, POST /internal/v1/tts):
  - Önce ElevenLabs, düşerse OpenAI gpt-4o-mini-tts.
  - Anahtarsız geliştirmede deneme tonu; üretimde ses uydurulmaz.
  - Anahtar biçimi açılışta denetlenir; load_settings() açılış hatasında ortam değerlerini yazmaz.
  - İstem şablonu "coach" (üslup).
- **Panel:** Yapay zekâ → AI koç sayfası (apps/admin/src/app/(panel)/coach/page.tsx): durum, ses seçimi, dinleme, hak, kriz hatları. CSP'ye media-src eklendi.
- **Web:** components/coach-voice.tsx (Dinle düğmesi, oynatıcı çubuğu); sohbette aranabilir kriz hatları; 11 dil.
- **Mobil:** expo-audio kuruldu (mikrofon izni şimdilik false). src/components/coach-voice.tsx, src/app/chat.tsx.
- **Testler:** apps/backend/src/coach.spec.ts, apps/ai-service/tests/test_voice.py; scripts/smoke.mjs'te koç bölümü (şablon sayısı 13).
- **Canlı anahtarlar:** ELEVENLABS, OPENAI ve ANTHROPIC sunucuda var; AI servisi bunlarla yeniden başlatıldı. Claude sohbeti açık, iki ses sağlayıcısı hazır.

## Sahibinden beklenen
- Panelde Türkçe ve İngilizce ses seçimi. Yapıldı mı, sahibine sor.
  - ElevenLabs'ta "Default" ve "Legacy" etiketli sesler 31 Aralık 2026'da kapanıyor; bunları seçtirme.
  - Seçimden sonra canlıda "Dinle"nin çaldığını sahibiyle doğrula. Canlıda test hesabı açma.

## Sahibinin kararları (değiştirme)
- **Sohbet modeli:** Claude, yedeği Kaptan (Türkiye'de, OpenAI uyumlu).
- **Ses:** ElevenLabs ve OpenAI'nin yeni modelleri. tts-1 (6 Ocak 2027) ve whisper-1 (26 Şubat 2027) kapanıyor; kullanma.
- **Mobil:** koç ekranlarını sen yazarsın ve iOS simülatöründe denersin. Mobilin geri kalanı sahibinindir.
- **Mağaza:** App Store'a ya da TestFlight'a sahibi istemeden gönderme.
- **Kota:** ücretsiz kullanıcı günde 10 mesaj, 1 dk dinleme, 3 sesli soru; Pro 100 mesaj, 15 dk, 30 sesli soru. Hepsi panelden değişir, ek hak krediyle alınır.

## Kalan işler (sırayla; her biri ayrı dal ve PR, sunucu + panel + web + mobil birlikte)
Her adıma başlamadan önce o adımın kısa planını (5–10 satır) ve varsa kararları sahibine sor, onay al. Her adımın sonunda dur ve rapor ver.

### 2. Sesle soru ve konuşma alanı (fal-app #85, #86)
- **Uç:** POST /v1/coach/transcribe (multipart).
  - En çok 60 sn ve 2 MB; dosya türü baytlarından denetlenir (m4a/aac, webm, wav).
  - Ses yazıya çevrildikten sonra hemen silinir.
  - Model OpenAI gpt-4o-mini-transcribe (whisper-1 değil).
- **Kota:** CoachSettingsSchema quota katmanlarına voiceQuestions ekle; yeni alan .default() ile, yoksa eski kayıt okunamaz.
  - Her tur bir istek kimliği taşısın, aynı tur iki kez ücretlenmesin. fal-app'te bu yoktu.
- **Kriz:** yazıya çevrilen metin kriz süzgecinden geçer.
- **Rıza:** ses yurt dışına gider (OpenAI). AI rızası ve yurt dışı aktarım rızası kontrol edilsin (KVKK).
- **Mikrofon:**
  - Mobil: app.json'da expo-audio eklentisine Türkçe mikrofon izni metni.
  - Web: MediaRecorder; Permissions-Policy ve CSP kontrol edilsin.
- **Konuşma alanı:** mobilde tam ekran. Dalga mikrofonun gerçek seviyesini (metering) gösterir; "hareketi azalt" açıksa sakin nabız. Web'de mikrofon düğmesi. Titreşim için expo-haptics.

### 3. Koç seçimi ve kişilik (fal-app #30, #36, #83, sesli-oturum.ts)
- **Sunucu:** Coach tablosu (ad, kısa tanım, ton, istem eki, TR ve EN sesleri, sıra, aktif).
  - Bugünkü genel ses varsayılan olarak kalır.
  - Kullanıcı seçtiği koçu (coachId) istediği an değiştirir.
  - Oturum koça bağlıdır: ses ve metin hep aynı koçtan gelir.
- **Panel:** Koçlar sayfası (ekle/düzenle, sesi dinleyerek seç). Koç adlarını ve kişiliklerini sahibine onaylat.

### 4. Sohbet geçmişi ve rızalı hafıza (fal-app #34)
- **Sunucu:** konuşma ve mesaj tabloları; tavan 20 not ve 30 tur.
  - Saklama süresi panelden (öneri 90 gün).
  - Kullanıcı geçmişini silebilir; veri indirme ve hesap silme bunu da kapsar.
- **Rıza:** "Koçum beni hatırlasın" ayrı bir anahtar; geri çekilince notlar silinir. KVKK metni güncellemesini sahibine bildir.

### 5. Proaktif koç (fal-app #26, #49, Yolculuk)
- **Oda planı:** koç bir plan önerir (ör. 1 fotoğraf, 2 stil, 3 yalnız koltuk). Tasarım kaydedilince adım kendiliğinden tamamlanır.
- **Öneriler:** yalnız veri varsa çıkar, uydurulmaz.
- **Hatırlatmalar:** push ve e-posta. Mevcut sessiz saat ve izin kapısından geçer.
  - Bildirim tercihleri tür tür kapatılabilir; işlem bildirimleri susturulmaz.
  - Her bildirim açacağı ekranın adresini taşır.
- **AI-01:** koç üretimi kendisi başlatmaz; "Stüdyoda aç" kullanıcının dokunuşuyla çalışır.

### 6. (isteğe bağlı) Stil testi
Fal-app'in kişilik testi motoru uyarlanır. Soru bankası panelden yönetilir, cevaplar stillere puan verir, sonuç koça ve stüdyoya öneri olarak gider.

### 1. adımdan kalan küçükler
- **Ek hak:** hak bitince "kredi ile devam".
- **Kaptan yedeği:** Claude cevap veremezse sohbet Kaptan'a düşer.
  - Ortam değişkeni adları ve taban adresi için fal-app services/ai/kaptan-arac.ts'e bak.
  - Anahtar sahibinde. Anahtarı isteme; adını söyle, sahibi set-secret.sh ile girer.

### Altyapı (BACKLOG)
- Sunucu dışında şifreli yedek.
- Sunucuyu dışarıdan yoklayan bir izleyici.
- Yedekten geri dönüş provası: yerelde yap, süre ve satır sayılarını kaydet.

## Kurallar
- **Gizli anahtarlar:**
  - Gizli anahtar isteme, ekrana ya da sohbete yazma.
  - .env, *.p8, *.pem dosyalarını açma. admin-credentials.txt'yi okuma (smoke.mjs onu kendisi okur).
  - Anahtarı sahibi girer: ssh hazal sonrası "sudo bash /var/www/casalume/app/deploy/hazal/set-secret.sh ai <AD>". Sonra "sudo -iu casalume pm2 restart casalume-ai".
  - Sunucuda anahtar kontrolü yalnız var/yok olarak yapılır. Biçim denetimi için ayrı süreçte load_settings() çalıştır ve yalnız evet/hayır yazdır.
- **Güvenlik:**
  - guvenlik skill'ini kullan, kontrol kimliklerine atıf yap: AI-01, INP, RES-01, AZ-01, FIL-01, KEY, LOG-02.
  - Kullanıcı metni koçun talimatına serbest metin olarak girmez.
  - Kullanıcı başına kota ve uzunluk sınırı olsun; ses dosyaları imzasız açılamasın.
- **KVKK:** AI'ya veri aktarımı için açık rıza korunur. Kriz mesajına güvenli cevap verilir.
- **Tasarım:**
  - Casalume kimliği: sıcak terrakota #a9532e, krem #f6f1ea, Cormorant ve Jakarta yazı tipleri, sade; herkes ve mimarlar için.
  - Mobil temanın kendi tokenları var; onları kullan.
  - fal-app'in renkleri, görselleri ve metinleri kopyalanmaz.
  - Türkçe ve İngilizce (web'de 11 dil), açık ve koyu tema, "hareketi azalt" desteği olsun.
- **Test:**
  - Her adımda olumlu ve olumsuz test yaz.
  - Komutlar: backend için "npx vitest run" ve "npx tsc --noEmit"; ai-service için "uv run pytest -q".
  - Duman testi: "node scripts/smoke.mjs", önce Redis'teki rl:* anahtarlarını sil. Bir uç durum kodunu değiştirmeden önce smoke.mjs'te o kodu ara.
  - Web ve panelde üretim derlemesi: NEXT_DIST_DIR=.next-check ile al. Sonra tsconfig'leri git checkout ile geri al ve .next-check'i sil.
  - Simülatörde gerçekten dene ve ekran görüntüsü göster.
- **Git (repo public):**
  - Dosyaları tek tek stage et, asla "git add -A" kullanma. PDF'leri, IMG_*.PNG dosyalarını ve .claude/ klasörünü commit etme.
  - Commit'ten önce "gitleaks git --staged" çıkış kodu 0 olmalı.
  - Commit kimliği: git -c user.name=metinemredonmez -c user.email=<sahibinin GitHub e-postası; bilmiyorsan sor> commit. Mesaj "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" satırıyla biter.
  - Her iş için dal aç (koc/2-..., koc/3-...) ve PR aç. PR açıklaması "🤖 Generated with [Claude Code](https://claude.com/claude-code)" satırıyla biter.
  - Birleştirmeden önce sahibine sor.
- **Yayın (birleştirdikten sonra):**
  - Komut: ssh hazal "sudo -iu casalume bash /var/www/casalume/app/deploy/hazal/deploy.sh". Arka planda çalıştır, çıktıyı geçici klasöre yönlendir.
  - Betik git pull yapar, yalnız değişen uygulamaları derler, göçleri uygular ve web ile paneli A/B klasörlerine derler.
  - Ardından pm2 uptime değerlerine ve yalnız yeni kodda olan bir uca bak (sadece /v1/health yetmez).
  - Canlıda yalnız okuma yapan kontroller yap; test verisi oluşturma.
  - Canlı DB ve .env okuma izni yok; herkese açık uçları kullan.
- **hazal paylaşılan sunucu:**
  - Yalnız casalume'a dokun; başka projelere dokunma.
  - "cyberpanel mailServerSSL" çalıştırma; sistem paketi kurma.
  - nginx değişikliği ve geri dönüşü olmayan işlemler için önce sor.
- **Yerel ortam:**
  - Sunucuları preview_start ile başlat (.claude/launch.json): ai-mock, backend, web, admin-3003 (3001 başka projede), mobile-ios.
  - Expo CLI Node 22 ister: PATH=$HOME/.nvm/versions/node/v22.18.0/bin:$PATH.
  - mobile-ios yapılandırması (CI=1), osascript izni yüzünden paket hazırlandıktan sonra çıkabilir. Uygulama açık kalır; Metro'yu --ios olmadan başlat ve simülatörde exp://<ip>:8081/--/chat adresini aç.
  - Geçici admin ve test kullanıcısını yalnız yerel DB'de aç, işin sonunda sil.
  - Kullandığın önizleme sunucularını kapat.
- **Çalışma biçimi:** tek adım, düşük yük. Sahibi istemedikçe ek oturum ya da ajan açma.
- **Rapor:** Türkçe, kısa ve sade. Ne yaptın, neyi denedin, ne kaldı, sahibinden ne gerekiyor.

## İlk iş
1. Yukarıdaki dosyaları oku.
2. Sahibine sor: panelde ses seçildi mi? Seçildiyse canlıda "Dinle"yi birlikte doğrulayın.
3. 2. adımın (sesle soru) kısa planını yaz, kararları sor ve onay al.
   - Karar 1: Mobilde sesli soru basılı tutarak mı sorulsun, dokun-başlat/dokun-bitir ile mi?
   - Karar 2: Web'de de mikrofon olsun mu?
