#!/usr/bin/env bash
# Casalume — builds every app on hazal. Run as the casalume user:  sudo -iu casalume bash /var/www/casalume/app/deploy/hazal/build.sh
# Full output goes to /var/www/casalume/build.log; on failure the last lines are shown.
set -euo pipefail

APP=/var/www/casalume/app
LOG=/var/www/casalume/build.log
[ "$(id -un)" = casalume ] || { echo "casalume kullanıcısıyla çalıştır: sudo -iu casalume bash $0" >&2; exit 1; }

: > "$LOG"
trap 'echo "HATA — son satırlar ($LOG):" >&2; tail -n 30 "$LOG" >&2' ERR
step() { echo "== $1 $(date +%H:%M:%S)" | tee -a "$LOG"; }
export NEXT_TELEMETRY_DISABLED=1

step backend
(cd "$APP/apps/backend" && npm ci --no-audit --no-fund && npx prisma generate && npm run build) >>"$LOG" 2>&1

step ai-service
(cd "$APP/apps/ai-service" && uv sync --frozen --no-dev) >>"$LOG" 2>&1

step admin
(cd "$APP/apps/admin" && npm ci --no-audit --no-fund && npm run build) >>"$LOG" 2>&1

step web
(cd "$APP/apps/web" && npm ci --no-audit --no-fund && npm run build) >>"$LOG" 2>&1

step bitti
