#!/usr/bin/env bash
# Casalume — hazal: creates the Postgres role/database, the Redis config and every .env file. Run once, as root.
# Secrets are generated here and never printed (KEY-01). What only the owner knows is left EMPTY on purpose:
# the backend refuses to start without the data controller (KVKK), the AI service without an image provider,
# so nothing goes live half-configured. Fill those in with deploy/hazal/set-secret.sh.
set -euo pipefail

ROOT=/var/www/casalume
APP=$ROOT/app
OWNER=casalume
MAILBOXES=/root/casalume/eposta-parolalari.txt

[ "$(id -u)" = 0 ] || { echo "root olarak çalıştır" >&2; exit 1; }
BACKEND_ENV=$APP/apps/backend/.env
AI_ENV=$APP/apps/ai-service/.env
ADMIN_ENV=$APP/apps/admin/.env.production.local
WEB_ENV=$APP/apps/web/.env.production.local
REDIS_CONF=$ROOT/redis/redis.conf
for f in "$BACKEND_ENV" "$AI_ENV" "$ADMIN_ENV" "$WEB_ENV" "$REDIS_CONF"; do
  [ -e "$f" ] && { echo "$f zaten var; hiçbir şeyin üzerine yazılmadı" >&2; exit 1; }
done

rand() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }
DB_PASS=$(rand); REDIS_PASS=$(rand); JWT=$(rand); IMG=$(rand); PEPPER=$(rand); AI_TOKEN=$(rand)
SMTP_PASS=$(awk '$1 == "no-reply@casalume.app" { print $2 }' "$MAILBOXES")
[ -n "$SMTP_PASS" ] || { echo "no-reply@casalume.app parolası $MAILBOXES içinde yok" >&2; exit 1; }

# Postgres: own role and database; the password goes in on stdin, never on a command line (ps, history).
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'casalume'" | grep -q 1; then
  echo "Postgres rolü 'casalume' zaten var; durdum" >&2; exit 1
fi
printf "CREATE ROLE casalume LOGIN PASSWORD '%s';\nCREATE DATABASE casalume OWNER casalume;\nREVOKE CONNECT ON DATABASE casalume FROM PUBLIC;\n" "$DB_PASS" \
  | sudo -u postgres psql -v ON_ERROR_STOP=1 -q

umask 077
install -d -o "$OWNER" -g "$OWNER" -m 700 "$ROOT/redis" "$ROOT/data" "$ROOT/backups"

cat > "$REDIS_CONF" <<EOF
# Casalume Redis (BullMQ + rate limits). Local only; the server's shared Redis on 6379 is not used.
port 6391
bind 127.0.0.1 ::1
protected-mode yes
requirepass $REDIS_PASS
dir $ROOT/redis
dbfilename dump.rdb
save 900 1
appendonly no
maxmemory 256mb
# BullMQ needs noeviction: an evicted job key would silently lose work.
maxmemory-policy noeviction
daemonize no
EOF

cat > "$BACKEND_ENV" <<EOF
NODE_ENV=production
PORT=4300
PUBLIC_BASE_URL=https://api.casalume.app
WEB_APP_URL=https://casalume.app
ADMIN_APP_URL=https://admin.casalume.app
CORS_ORIGINS=https://casalume.app,https://www.casalume.app,https://admin.casalume.app
# nginx in front, one hop (NET-03)
TRUSTED_PROXY_HOPS=1
DATABASE_URL=postgresql://casalume:$DB_PASS@127.0.0.1:5432/casalume?schema=public
REDIS_URL=redis://:$REDIS_PASS@127.0.0.1:6391/0
JWT_SECRET=$JWT
IMAGE_URL_SECRET=$IMG
DEVICE_PEPPER=$PEPPER
AI_INTERNAL_TOKEN=$AI_TOKEN
AI_SERVICE_URL=http://127.0.0.1:8300
MAIL_TRANSPORT=smtp
SMTP_URL=smtps://no-reply%40casalume.app:$SMTP_PASS@mail.casalume.app:465
MAIL_FROM=Casalume <no-reply@casalume.app>
DATA_DIR=$ROOT/data
STORAGE_DRIVER=local
PUSH_TRANSPORT=expo
# 2-core shared server
MAX_CONCURRENT_GENERATIONS=2
CREDIT_PACKS=casalume_credits_10:10,casalume_credits_50:50
# KVKK data controller — required; the API does not start while these are empty (set-secret.sh)
LEGAL_CONTROLLER_NAME=
LEGAL_CONTROLLER_ADDRESS=
LEGAL_CONTACT_EMAIL=kvkk@casalume.app
# First super admin, used once by \`npm run db:seed\` (set-secret.sh)
ADMIN_EMAIL=
# Later: RevenueCat, Sign in with Apple / Google, Sentry (docs/RUNBOOK.md)
EOF

cat > "$AI_ENV" <<EOF
ENV=production
INTERNAL_TOKEN=$AI_TOKEN
# gemini | replicate | falai — required; empty refuses to start (set-secret.sh)
IMAGE_PROVIDER=
IMAGE_FALLBACKS=
GEMINI_API_KEY=
REPLICATE_API_TOKEN=
FAL_KEY=
ANTHROPIC_API_KEY=
MAX_CONCURRENT_GENERATIONS=2
EOF

cat > "$ADMIN_ENV" <<EOF
API_BASE_URL=http://127.0.0.1:4300/v1
IMAGE_ORIGINS=https://api.casalume.app
ADMIN_ORIGIN=https://admin.casalume.app
EOF

cat > "$WEB_ENV" <<EOF
API_BASE_URL=http://127.0.0.1:4300/v1
NEXT_PUBLIC_APP_URL=https://casalume.app
IMAGE_ORIGINS=https://api.casalume.app
EOF

chown "$OWNER:$OWNER" "$BACKEND_ENV" "$AI_ENV" "$ADMIN_ENV" "$WEB_ENV" "$REDIS_CONF"
chmod 600 "$BACKEND_ENV" "$AI_ENV" "$ADMIN_ENV" "$WEB_ENV" "$REDIS_CONF"
echo "hazır: veritabanı, Redis ayarı ve 4 .env dosyası (değerler yazdırılmadı)"
echo "eksik: LEGAL_CONTROLLER_NAME, LEGAL_CONTROLLER_ADDRESS, ADMIN_EMAIL (backend) · IMAGE_PROVIDER + anahtarı (AI)"
