# AI Room — sunucu kurulumu, yayın ve yedek (runbook)

Hedef: tek bir Ubuntu 24.04 sunucu, Docker yok. Servisler systemd ile çalışır; Postgres ve Redis aynı makinededir ve
yalnız `localhost`'tan erişilir. HTTPS ve ters vekil (reverse proxy) Caddy'dir; sertifikayı kendisi alır ve yeniler.

```
İnternet ──443──► Caddy ──► backend   127.0.0.1:4000  (api.<alan>)
                        ├─► web       127.0.0.1:3000  (<alan>, web aşamasında)
                        └─► admin     127.0.0.1:3001  (admin.<alan>, admin aşamasında)
backend ──► ai-service 127.0.0.1:8001 · Postgres 127.0.0.1:5432 · Redis 127.0.0.1:6379
```

Dışarı yalnız 22 (SSH), 80 ve 443 açıktır (NET-02). AI servisi, Postgres ve Redis dışarıdan görünmez (NET-04).

## 0. Senden gerekenler

| # | Bilgi | Not |
|---|---|---|
| 1 | Sunucu: IP ve SSH erişimi | En az 2 vCPU, 4 GB RAM, 40 GB disk. SSH yalnız anahtarla. |
| 2 | Alan adı ve DNS | `api.`, `admin.` ve ana alan için A/AAAA kayıtları sunucuya. |
| 3 | E-posta (SMTP) | Doğrulama, şifre sıfırlama ve KVKK e-postaları için. Alan adında SPF, DKIM, DMARC (MAIL-02). |
| 4 | Veri sorumlusu (KVKK) | Şirket unvanı, adres, KVKK iletişim e-postası, varsa KEP adresi. |
| 5 | Görsel deposu | `local` (sunucu diski, yedeği bizde) ya da Cloudflare R2 (önerilen: dayanıklı, yedek yükü azalır). |
| 6 | Yedek hedefi | Sunucu dışı bir yer: R2/S3 kovası ya da Hetzner Storage Box. Yedek sunucuda kalırsa yedek sayılmaz. |
| 7 | AI anahtarları | Gemini / fal.ai / Anthropic (hangileri kullanılacaksa). Sen `.env` dosyasına kendin girersin. |
| 8 | İsteğe bağlı | Sentry DSN, RevenueCat, Apple/Google giriş anahtarları, Expo access token. |

Sırlar chat'e, repoya ya da log'a yazılmaz; yalnız sunucudaki `/etc/airoom/*.env` dosyalarına girer (KEY-01).

## 1. Sunucu hazırlığı (bir kez)

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades ufw git curl ca-certificates build-essential pipx age
sudo dpkg-reconfigure -plow unattended-upgrades          # güvenlik güncellemeleri otomatik
sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
sudo adduser --system --group --home /opt/airoom --shell /usr/sbin/nologin airoom
sudo install -d -o airoom -g airoom -m 750 /opt/airoom/releases /var/lib/airoom /var/lib/airoom/backend
sudo install -d -o root -g airoom -m 750 /etc/airoom
```

SSH: `/etc/ssh/sshd_config.d/10-hardening.conf` içine `PasswordAuthentication no` ve `PermitRootLogin no`, sonra
`sudo systemctl reload ssh`. Önce anahtarla giriş yapabildiğini ayrı bir oturumda doğrula.

**Node 22 (NodeSource), Caddy, uv**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh   # betiği okuduktan sonra çalıştır
sudo bash /tmp/nodesource.sh && sudo apt install -y nodejs
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
sudo -u airoom -H pipx install uv        # /opt/airoom/.local/bin/uv
```

## 2. Postgres ve Redis

```bash
sudo apt install -y postgresql redis-server
sudo -u postgres createuser --pwprompt airoom              # güçlü parola: openssl rand -base64 32
sudo -u postgres createdb -O airoom airoom
```
- Postgres varsayılanda yalnız `localhost`'u dinler; `listen_addresses` değiştirilmez.
- Redis (`/etc/redis/redis.conf`):
  - `bind 127.0.0.1 -::1` ve `protected-mode yes` (Ubuntu varsayılanı).
  - `requirepass <openssl rand -hex 32>`.
  - `maxmemory 256mb` ve **`maxmemory-policy noeviction`**: BullMQ kuyruk anahtarları silinmemeli.
  - Sonra `sudo systemctl restart redis-server`.

## 3. Ortam dosyaları

`/etc/airoom/backend.env` (sahip `root:airoom`, izin `640`). `.env.example` başlangıçtır; üretimde zorunlu olanlar:

```ini
NODE_ENV=production
PORT=4000
PUBLIC_BASE_URL=https://api.<alan>
WEB_APP_URL=https://<alan>
ADMIN_APP_URL=https://admin.<alan>
CORS_ORIGINS=https://<alan>,https://admin.<alan>
TRUSTED_PROXY_HOPS=1                   # yalnız Caddy önde (NET-03)
DATABASE_URL=postgresql://airoom:<parola>@127.0.0.1:5432/airoom
REDIS_URL=redis://:<redis-parolası>@127.0.0.1:6379/0
DATA_DIR=/var/lib/airoom/backend
AI_SERVICE_URL=http://127.0.0.1:8001
# Her biri ayrı: openssl rand -base64 48 (aynı değer iki kez kullanılırsa backend açılmaz)
JWT_SECRET=
IMAGE_URL_SECRET=
DEVICE_PEPPER=
AI_INTERNAL_TOKEN=                     # ai-service.env içindeki INTERNAL_TOKEN ile aynı
MAIL_TRANSPORT=smtp
SMTP_URL=smtps://<kullanıcı>:<parola>@<sunucu>:465
MAIL_FROM=AI Room <no-reply@<alan>>
PUSH_TRANSPORT=expo
LEGAL_CONTROLLER_NAME=
LEGAL_CONTROLLER_ADDRESS=
LEGAL_CONTACT_EMAIL=
# STORAGE_DRIVER=s3 + S3_* (R2 seçilirse), SENTRY_*, REVENUECAT_*, APPLE_*/GOOGLE_* (kullanılıyorsa)
```

`/etc/airoom/ai-service.env` (`root:airoom`, `640`):
```ini
ENV=production
INTERNAL_TOKEN=                        # backend.env içindeki AI_INTERNAL_TOKEN
IMAGE_PROVIDER=gemini                  # üretimde mock reddedilir
GEMINI_API_KEY=
# FAL_KEY, ANTHROPIC_API_KEY, IMAGE_FALLBACKS, SENTRY_DSN ...
```

Backend ve AI servisi güvensiz bir üretim ayarında **açılmaz**; hata mesajı eksik ayarı adıyla söyler (`journalctl -u airoom-backend`).

## 4. systemd servisleri

`/etc/systemd/system/airoom-ai.service`
```ini
[Unit]
Description=AI Room AI service
After=network-online.target
Wants=network-online.target

[Service]
User=airoom
Group=airoom
WorkingDirectory=/opt/airoom/current/apps/ai-service
EnvironmentFile=/etc/airoom/ai-service.env
ExecStart=/opt/airoom/current/apps/ai-service/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --no-access-log
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
LockPersonality=yes
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/airoom-backend.service`: aynı sertleştirme satırları, şu farklarla:
```ini
[Unit]
Description=AI Room backend API
After=network-online.target postgresql.service redis-server.service airoom-ai.service
Wants=network-online.target

[Service]
WorkingDirectory=/opt/airoom/current/apps/backend
EnvironmentFile=/etc/airoom/backend.env
ExecStart=/usr/bin/node dist/main.js
TimeoutStopSec=30                      # kuyruk işleri bitirip kapanır
ReadWritePaths=/var/lib/airoom/backend
# + airoom-ai.service'teki User/Group/Restart/UMask ve sertleştirme satırları
```

`MemoryDenyWriteExecute` eklenmez: Node'un JIT derleyicisini bozar.

```bash
sudo systemctl daemon-reload && sudo systemctl enable airoom-ai airoom-backend
```

## 5. Caddy

`/etc/caddy/Caddyfile`
```
api.<alan> {
	encode zstd gzip
	request_body {
		max_size 15MB
	}
	reverse_proxy 127.0.0.1:4000
}
# admin.<alan> ve <alan>: admin ve web aşamasında eklenecek (127.0.0.1:3001 / 3000)
```
`sudo systemctl reload caddy`. Güvenlik başlıklarını backend kendisi gönderir (helmet). Swagger üretimde kapalıdır.

## 6. İlk yayın ve güncelleme

Her yayın ayrı bir klasöre kurulur; `current` sembolik bağlantısı yayındaki sürümü gösterir. Geri dönmek bağlantıyı
eski klasöre çevirmektir.

```bash
sudo -u airoom -H bash -lc '
set -euo pipefail
REL=/opt/airoom/releases/$(date +%Y%m%d%H%M)
git clone --depth 1 --branch main https://github.com/metinemredonmez/ai-room-app "$REL"
cd "$REL/apps/backend"
set -a; . /etc/airoom/backend.env; set +a
npm ci && npm run build
cd "$REL/apps/ai-service" && ~/.local/bin/uv sync --locked --no-dev
echo "$REL" > /opt/airoom/next-release
'
```
`/etc/airoom/backend.env` `airoom` grubuna okunabilir olduğundan derleme `airoom` kullanıcısıyla çalışır.

```bash
sudo systemctl start airoom-backup.service      # 1) migrasyondan önce yedek (§7; ilk yayında veritabanı boş, atlanır)
REL=$(cat /opt/airoom/next-release)
sudo -u airoom -H bash -lc "cd $REL/apps/backend && set -a && . /etc/airoom/backend.env && set +a && npx prisma migrate deploy"
sudo -u airoom ln -sfn "$REL" /opt/airoom/current
sudo systemctl restart airoom-ai airoom-backend
curl -fsS https://api.<alan>/v1/health | grep -q '"status":"ok"' && echo SAĞLIKLI   # 2) "degraded" ise hangi parça "down" bak
```

- İlk yayında bir kez:
  - `current/apps/backend` içinde, ortam dosyası yüklüyken (yukarıdaki migrasyon komutu gibi) `npm run db:seed` çalıştır. Admin bilgisi `/var/lib/airoom/backend/admin-credentials.txt` dosyasına (izin 600) yazılır.
  - Bilgiyi parola yöneticine al, dosyayı sil, ilk girişte TOTP kur.
  - Yasal metinler ilk açılışta yayınlanır. **Önce hukukçu onayı alınmalı.**
- Geri dönüş:
  - `ln -sfn <önceki klasör> /opt/airoom/current`, ardından iki servisi yeniden başlat.
  - Yeni sürüm şemayı değiştirdiyse ve eski kod yeni şemayla çalışmıyorsa veritabanı 1. adımdaki yedekten geri yüklenir (§7).
- Eski yayınlar: son 3 klasör tutulur, diğerleri silinir.

## 7. Yedekleme ve geri yükleme (DAT)

**Ne yedeklenir:**
- Postgres: her gece ve her migrasyondan önce.
- Görseller: `STORAGE_DRIVER=local` ise `/var/lib/airoom/backend/images`.
- `/etc/airoom/` sırları ayrı tutulur: parola yöneticisinde, yedekle aynı yerde değil.

Yedekler `age` ile şifrelenir. Açık anahtar sunucudadır, gizli anahtar yalnız sende kalır; sunucu ele geçirilse de
yedekler okunamaz.

`/usr/local/bin/airoom-backup` (root, `750`):
```bash
#!/usr/bin/env bash
set -euo pipefail
DIR=/var/backups/airoom; STAMP=$(date +%Y%m%d-%H%M); RECIPIENT=$(cat /etc/airoom/backup-recipient.txt)
install -d -m 700 "$DIR"
sudo -u postgres pg_dump -Fc airoom | age -r "$RECIPIENT" > "$DIR/db-$STAMP.dump.age"
[ -d /var/lib/airoom/backend/images ] && tar -C /var/lib/airoom/backend -cf - images | age -r "$RECIPIENT" > "$DIR/images-$STAMP.tar.age"
find "$DIR" -name '*.age' -mtime +14 -delete
# Sunucu dışına kopya (hedef §0/6'ya göre), örn: rclone copy "$DIR" offsite:airoom-backups --max-age 25h
```

`/etc/systemd/system/airoom-backup.service` (`Type=oneshot`, `ExecStart=/usr/local/bin/airoom-backup`) ve
`airoom-backup.timer` (`OnCalendar=*-*-* 03:00`, `Persistent=true`):
`sudo systemctl enable --now airoom-backup.timer`.

**Geri yükleme provası (ayda bir):** yedek, geri yüklenebildiği kanıtlanana kadar yedek sayılmaz.
```bash
age -d -i ~/airoom-backup.key db-<tarih>.dump.age > /tmp/db.dump          # kendi bilgisayarında ya da sunucuda
sudo -u postgres createdb airoom_restore_test
sudo -u postgres pg_restore -d airoom_restore_test --no-owner /tmp/db.dump
sudo -u postgres psql -d airoom_restore_test -c 'select count(*) from "User";'
sudo -u postgres dropdb airoom_restore_test && rm /tmp/db.dump
```
Gerçek geri yükleme: servisleri durdur, `pg_restore --clean --if-exists -d airoom`, servisleri başlat, `/v1/health` kontrol et.

## 8. İzleme ve olay müdahalesi

- **Sağlık kontrolü:**
  - `https://api.<alan>/v1/health`: veritabanı, Redis, AI servisi ve depolama durumunu verir. Bir parça çökse de 200 döner
    (`status: "degraded"`); izleyici HTTP kodunu değil, yanıttaki `"status":"ok"` metnini kontrol etmeli.
  - Dış bir izleyiciye (ör. UptimeRobot) bağlanır.
- **Loglar:**
  - `journalctl -u airoom-backend -f` ve `journalctl -u airoom-ai -f`. Loglar JSON'dur ve kişisel veri taşımaz.
  - journald boyutu `SystemMaxUse=1G`.
- **Hatalar:** Sentry (DSN verilirse). Rapordaki `requestId` ile log satırı bulunur.
- **Disk:** `df -h` %80'i geçerse uyar. Görseller `local` sürücüdeyse en hızlı büyüyen kısım odur.
- **Sır sızarsa:**
  - İlgili değeri `/etc/airoom/*.env` içinde değiştir ve servisi yeniden başlat.
  - `JWT_SECRET` değişince bütün oturumlar kapanır.
  - `IMAGE_URL_SECRET` değişince eski görsel bağlantıları geçersiz olur.
  - Sağlayıcı anahtarları sağlayıcının panelinden iptal edilir.
- **Yayın sonrası kontrol:** `redteam headers https://api.<alan>` ile güvenlik başlıkları doğrulanır; değişiklik takibi için
  `--save-baseline` kullanılır.
- **KVKK veri ihlali:** öğrenildiği andan itibaren 72 saat içinde Kurul'a bildirim yapılır. Logları ve yedekleri koru;
  hiçbir şeyi silme.
