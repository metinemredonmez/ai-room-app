# Casalume — sunucu kurulumu ve işletim (hazal)

Casalume, paylaşımlı **hazal** sunucusunda çalışır (Ubuntu 24.04, CyberPanel 2.4, `94.138.209.152`, SSH adı `hazal`).
Sunucuda başka projeler de var (hazal, maeyja, playce, ogulcanates, vortek…). Kurallar:

- Casalume ayrı **`casalume`** kullanıcısıyla ve **onun PM2'siyle** çalışır; diğer projelerin root PM2'sine karışmaz.
- Portlar yalnız `127.0.0.1`: **API 4300 · AI 8300 · admin 3300 · web 3301 · Redis 6391**. Dışarıya yalnız nginx (80/443).
- Kendi Postgres veritabanı/rolü (`casalume`) ve kendi Redis'i; ortak Redis (6379) ve diğer veritabanlarına dokunulmaz.
- Sırlar yalnız sunucudaki `.env` dosyalarında (chmod 600, sahibi `casalume`); sohbete, depoya ve log'a girmez (KEY-01).
- Dosyalar: `deploy/hazal/` (PM2, nginx, `.env` üretici, sır girişi, yedek).

Önceki sürüm (ayrı sunucu, systemd + Caddy) git geçmişinde: `git log -- docs/RUNBOOK.md`.

## 0. Önkoşullar

- DNS (Namecheap): `@`, `www`, `api`, `admin`, `mail` → `94.138.209.152`; MX `mail.casalume.app`; SPF, DKIM (`default`), DMARC.
- E-posta (CyberPanel): `no-reply@`, `support@`, `kvkk@casalume.app`; parolaları `/root/casalume/eposta-parolalari.txt` (600).
  **`cyberpanel mailServerSSL` paylaşımlı sunucuda kullanılmaz**: sunucunun genel posta adını (`myhostname`) değiştirir.
  Postfix `myhostname` her zaman `mail.hazalmuti.com` kalır (PTR ile eşleşir).
- Sahibinden: veri sorumlusu adı ve adresi (KVKK), ilk süper yöneticinin e-postası, görsel sağlayıcısı ve anahtarı,
  `ANTHROPIC_API_KEY`. Hepsi `set-secret.sh` ile sunucuda girilir.

## 1. Kullanıcı, klasör, kod (root)

```bash
adduser --system --group --home /var/www/casalume --shell /bin/bash casalume
sudo -iu casalume git clone --depth 1 https://github.com/metinemredonmez/ai-room-app /var/www/casalume/app
```

## 2. Veritabanı, Redis ayarı ve `.env` dosyaları (root, bir kez)

```bash
bash /var/www/casalume/app/deploy/hazal/make-env.sh
```

Parolalar ve anahtarlar üretilir, yazdırılmaz. Boş bırakılanlar (bunlar olmadan API ve AI servisi **başlamaz**):

```bash
S=/var/www/casalume/app/deploy/hazal/set-secret.sh
bash $S backend LEGAL_CONTROLLER_NAME
bash $S backend LEGAL_CONTROLLER_ADDRESS
bash $S backend ADMIN_EMAIL
bash $S ai IMAGE_PROVIDER          # gemini | replicate | falai
bash $S ai GEMINI_API_KEY          # ya da REPLICATE_API_TOKEN / FAL_KEY
bash $S ai ANTHROPIC_API_KEY
```

## 3. Derleme (casalume)

uv bir kez kurulur (root): `curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh`.

```bash
sudo -iu casalume bash /var/www/casalume/app/deploy/hazal/build.sh     # ayrıntı: /var/www/casalume/build.log
```

## 4. Veritabanı şeması ve ilk yönetici (casalume)

```bash
sudo -iu casalume bash -lc 'cd /var/www/casalume/app/apps/backend && npm run db:migrate && npm run db:seed'
```

Seed stilleri, yasal metinleri ve `ADMIN_EMAIL` için süper yöneticiyi oluşturur. Parola, TOTP sırrı ve yedek kodlar
`/var/www/casalume/data/admin-credentials.txt` (600) dosyasındadır: `otpauth` satırı doğrulayıcı uygulamaya eklenir,
sonra dosya silinir. Canlıda MFA zorunludur (AUT-01).

**Panelden kodsuz giriş (sahibinin kararı, 4 Kasım 2026; risk kabul edildi).** `ADMIN_PANEL_KEY` tanımlıyken
admin.casalume.app üzerinden yapılan girişler yalnız e-posta + parola ister. Panel sunucusu bu anahtarı backend'e
iletir; anahtar tarayıcıya hiç gitmez.

- Neden kabul edilebilir: panel nginx'te yalnız izinli adreslere açıktır (`allow …; deny all;`).
- API'ye (api.casalume.app) doğrudan yapılan admin girişlerinde kod yine zorunludur.
- Her kodsuz giriş denetim kaydına `factor: panel` olarak yazılır.

```bash
bash /var/www/casalume/app/deploy/hazal/panel-key.sh       # aç (yeni anahtar, ekrana basılmaz)
bash /var/www/casalume/app/deploy/hazal/panel-key.sh off   # kapat (kod her yerde yeniden zorunlu)
sudo -iu casalume pm2 reload casalume-api --update-env
sudo -iu casalume pm2 reload casalume-admin --update-env
```

Panel izinli adreslerin dışına açılırsa (ör. Tailscale olmadan her yerden) önce `panel-key.sh off` çalıştırılır.
Anahtar kapatılınca kodsuz alınmış oturumlar bir sonraki istekte düşer.

## 5. PM2 (casalume)

```bash
sudo -iu casalume pm2 start /var/www/casalume/app/deploy/hazal/ecosystem.config.cjs
sudo -iu casalume pm2 save
pm2 startup systemd -u casalume --hp /var/www/casalume      # root; yazdırdığı komut da çalıştırılır
sudo -iu casalume bash -lc 'pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 20M && pm2 set pm2-logrotate:retain 10 && pm2 set pm2-logrotate:compress true'
```

Yerel kontrol: `curl -s http://127.0.0.1:4300/v1/health`, `sudo -iu casalume pm2 list`.

## 6. nginx ve sertifikalar (root)

```bash
cp /var/www/casalume/app/deploy/hazal/nginx-casalume.conf /etc/nginx/sites-available/casalume
ln -sf /etc/nginx/sites-available/casalume /etc/nginx/sites-enabled/casalume
nginx -t && systemctl reload nginx
certbot --nginx --cert-name casalume --redirect \
  -d casalume.app -d www.casalume.app -d api.casalume.app -d admin.casalume.app -d mail.casalume.app
```

`nginx -t` başarısızsa reload yapılmaz; diğer siteler etkilenmez.

**Posta sunucusu sertifikası** yalnız Casalume için, SNI ile (diğer alan adları kendi sertifikasında kalır):

1. `/etc/postfix/vmail_ssl.map` içinde CyberPanel'in yazdığı `casalume.app …` satırı yerine:
   `mail.casalume.app /etc/letsencrypt/live/casalume/privkey.pem /etc/letsencrypt/live/casalume/fullchain.pem`
2. `/etc/dovecot/dovecot.conf` içindeki `local_name casalume.app { … }` bloğu `local_name mail.casalume.app` olur ve
   aynı iki dosyayı gösterir.
3. `postmap -F hash:/etc/postfix/vmail_ssl.map && doveconf -n >/dev/null && postfix reload && systemctl reload dovecot`
4. Yenilemede yeniden yükleme: `/etc/letsencrypt/renewal-hooks/deploy/casalume-mail.sh` →
   `postfix reload; systemctl reload dovecot`.

Dış kontrol (Mac): `curl -s https://api.casalume.app/v1/health` ve
`openssl s_client -connect mail.casalume.app:465 -servername mail.casalume.app </dev/null | grep -E 'subject|verify'`.

## 7. Yedekleme (DAT)

`sudo -iu casalume crontab -e`:

```
17 3 * * *  /bin/bash /var/www/casalume/app/deploy/hazal/backup.sh >> /var/www/casalume/backups/backup.log 2>&1
```

Veritabanı dökümü ve görseller günlük, son 14'ü tutulur (`/var/www/casalume/backups`, 600). **Sunucu dışına kopya
sahibinin kararı**: disk ya da sunucu kaybında yerel yedek de gider; öneri, günlük şifreli kopya (age + rclone) ayrı
bir depolamaya.

Geri yükleme (yalnız gerektiğinde): servisleri durdur (`pm2 stop casalume-api casalume-ai`), `pg_restore --clean
--if-exists -d casalume <döküm>`, görselleri `tar -xzf` ile `data/` altına aç, servisleri başlat, `/v1/health` kontrol et.

## 8. Güncelleme

```bash
sudo -iu casalume bash /var/www/casalume/app/deploy/hazal/deploy.sh          # yalnız değişen uygulamalar
sudo -iu casalume bash /var/www/casalume/app/deploy/hazal/deploy.sh --all    # hepsi
```

`deploy.sh` önce `git pull --ff-only` yapar. Ardından son yayından beri değişen uygulamaları sırayla günceller:

- **API:** derleme ve migrasyon, sonra `casalume-api` yeniden başlatılır.
- **AI servisi:** gerekirse `uv sync`, sonra yeniden başlatma.
- **Admin ve web:** her biri iki klasörden boşta olanına (`.next-a` / `.next-b`) derlenir. `.next` canlı olanı gösteren bir bağlantıdır. Derleme başarılı olunca bağlantı çevrilir ve yalnız o uygulama yeniden başlatılır.

Derleme sürerken site eski sürümle tam çalışır; kesinti yalnız yeniden başlatma süresi kadardır. Bir önceki sürümün statik dosyaları yeni sürüme kopyalanır, böylece tarayıcıda açık kalan sayfalar betiklerini yükleyebilir.

Bir adım hata verirse betik durur, sonraki uygulamaya geçmez ve log son satırlarını gösterir. Ayrıntılı çıktı `/var/www/casalume/deploy.log` dosyasındadır, son yayın commit'leri `/var/www/casalume/.deployed/` altında tutulur.

`build.sh` yalnız ilk kurulum içindir. `next build` çalışan sunucunun klasörünü boşaltır; 6 Kasım 2026'da yerinde derleme sırasında sayfalar ve betikleri dakikalarca 404/500 verdi.

Migrasyondan önce `backup.sh` elle çalıştırılır.

## 9. İzleme ve olay müdahalesi

- Loglar: `sudo -iu casalume pm2 logs casalume-api` (JSON; kişisel veri taşımaz). AI: `pm2 logs casalume-ai`.
- `/v1/health` DB, Redis ve AI servisini birlikte yoklar; dışarıdan bir uptime izleyicisi bağlanır.
- Sır sızdıysa: ilgili değeri `set-secret.sh` ile değiştir, `pm2 restart` (JWT sırrı değişirse tüm oturumlar düşer).
- Paylaşımlı sunucuda değişiklikten önce ve sonra diğer sitelerin durumu (`curl -s -o /dev/null -w %{http_code}`) ve
  `nginx -t` kaydedilir.
