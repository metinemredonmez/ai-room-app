#!/usr/bin/env bash
# Admin panel logins without the 6-digit code (owner decision, 4 Nov 2026; docs/RUNBOOK.md).
# Generates ADMIN_PANEL_KEY and writes the same value to the backend and admin env files — never printed.
# The code is still required for admin logins made directly against the public API.
#   bash /var/www/casalume/app/deploy/hazal/panel-key.sh        → on (new key)
#   bash /var/www/casalume/app/deploy/hazal/panel-key.sh off    → off (code required everywhere again)
set -euo pipefail

BACKEND=/var/www/casalume/app/apps/backend/.env
ADMIN=/var/www/casalume/app/apps/admin/.env.production.local

case "${1:-on}" in
  on) VALUE=$(openssl rand -hex 32) ;;
  off) VALUE="" ;;
  *) echo "kullanım: panel-key.sh [on|off]" >&2; exit 2 ;;
esac

for f in "$BACKEND" "$ADMIN"; do
  [ -f "$f" ] || { echo "$f yok" >&2; exit 1; }
  TMP=$(mktemp)
  # Drop any old line, then append the new one (none when turning off); cat > keeps owner and mode 600.
  VALUE="$VALUE" awk '
    index($0, "ADMIN_PANEL_KEY=") == 1 { next }
    { print }
    END { if (ENVIRON["VALUE"] != "") print "ADMIN_PANEL_KEY=\"" ENVIRON["VALUE"] "\"" }' "$f" > "$TMP"
  cat "$TMP" > "$f"
  rm -f "$TMP"
done

echo "ADMIN_PANEL_KEY ${1:-on}: backend ve admin dosyaları güncellendi."
echo "Şimdi iki uygulamayı yeniden başlat:"
echo "  sudo -iu casalume pm2 reload casalume-api --update-env"
echo "  sudo -iu casalume pm2 reload casalume-admin --update-env"
