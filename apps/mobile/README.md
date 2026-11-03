# AI Room — Mobil uygulama (Expo)

iOS, Android ve web için tek kod tabanı. Expo SDK 58, React Native 0.88, Expo Router.
Tüm istekler backend'e (`docs/API.md`, `/v1`) gider; AI servisine doğrudan bağlanmaz.

## Gereksinimler

- **Node 22.13+** (React Native 0.88 Node 20'de çalışmaz) — `nvm use` (`.nvmrc` = 22)
- Çalışan backend: `http://localhost:4000/v1`
- iOS Simulator için Xcode, Android için Android Studio; ya da telefonda Expo Go / development build

## Kurulum ve çalıştırma

```bash
cd apps/mobile
nvm use
npm install
cp .env.example .env        # EXPO_PUBLIC_API_URL'i gerekirse değiştir
npx expo start              # i: iOS simülatör, a: Android, w: web
```

- **iOS Simülatör:** `npm run ios` — `localhost` doğrudan Mac'teki backend'e gider.
- **Android emülatör:** `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000/v1`
- **Fiziksel cihaz:** bilgisayarın yerel IP'sini yaz, ör. `http://192.168.1.20:4000/v1`, ve backend CORS/ağ erişimine izin ver.
- **Web:** `npm run web` (port 8081). Backend `CORS_ORIGINS` içinde `http://localhost:8081` olmalı.

`expo-secure-store` ve `expo-image-picker` Expo Go'da hazır gelir; mağaza derlemesi için
`npx eas-cli@latest build --profile production`.

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://localhost:4000/v1` | Backend taban adresi (istemci paketine gömülür — sır koymayın) |

## Yapı

```
src/
  app/                      Expo Router ekranları
    _layout.tsx             Kök Stack + oturum/başlangıç kapısı (çevrimdışı ekranı, onboarding yönlendirmesi)
    (tabs)/                 Ana Sayfa · İlham · Tasarımlarım · Profil (iOS/Android: NativeTabs, web: üst menü)
    onboarding.tsx          İlk açılış, 3 slayt + KVKK onayı
    create.tsx              Araç → fotoğraf → seçenekler → üretim (katalogdaki tool.needs'e göre)
    design/[id].tsx         Önce/sonra kaydırıcı, varyantlar, favori, paylaş, analiz, sohbete gönder
    chat.tsx                AI tasarım asistanı (görsel ekleme, öneri çipleri)
    paywall.tsx             PRO planları (TRY), demo yükseltme
    auth.tsx                Kayıt / giriş (misafir hesabı yerinde yükseltilir)
  components/               UI kiti, önce/sonra kaydırıcı, analiz görünümü, üretim ilerleme katmanı
  lib/
    api.ts                  Tipli API istemcisi, Bearer + tek uçuşlu refresh rotasyonu
    session.tsx             Oturum, misafir girişi (cihaz kimliği), katalog, dil
    i18n.ts                 TR (varsayılan) / EN metinleri, TL biçimlendirme
    storage.ts              Token: Keychain/Keystore (expo-secure-store); web'de localStorage
    pick-image.ts           Galeri/kamera → base64 → POST /uploads (imzaya göre MIME)
```

## Güvenlik notları

- Token'lar native'de güvenli depoda tutulur; 401'de tek seferlik refresh, başarısızsa misafir oturuma düşülür.
- Model çıktısı yalnızca düz metin olarak gösterilir; sohbet önerileri üretimi otomatik başlatmaz,
  yalnızca tasarım ekranını doldurur (AI-01/AI-02).
- Mağaza bağlantıları yalnızca `http(s)` ise açılır.
- Ödeme demo: `POST /billing/dev-upgrade`. Üretimde RevenueCat (App Store / Google Play) +
  sunucu tarafı makbuz doğrulaması gerekir (`paywall.tsx` içindeki TODO).

## Kontroller

```bash
npm run typecheck
npm run lint
npm run export:web
```
