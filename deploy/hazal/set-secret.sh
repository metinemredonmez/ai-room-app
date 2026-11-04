#!/usr/bin/env bash
# Sets one value in a Casalume .env file without it ever appearing on screen, in argv or in shell history.
# Usage (on hazal, as root):  bash /var/www/casalume/app/deploy/hazal/set-secret.sh <backend|ai> <KEY>
set -euo pipefail

case "${1:-}" in
  backend) FILE=/var/www/casalume/app/apps/backend/.env ;;
  ai) FILE=/var/www/casalume/app/apps/ai-service/.env ;;
  *) echo "kullanım: set-secret.sh <backend|ai> <ANAHTAR>" >&2; exit 2 ;;
esac
KEY=${2:-}
[[ "$KEY" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "geçersiz anahtar adı: '$KEY'" >&2; exit 2; }
[ -f "$FILE" ] || { echo "$FILE yok; önce make-env.sh" >&2; exit 1; }

read -rsp "$KEY değeri (görünmez): " VALUE
echo
[ -n "$VALUE" ] || { echo "boş değer; değişiklik yapılmadı" >&2; exit 1; }
case "$VALUE" in *'"'* | *$'\n'* | *'\'* ) echo "değer \" veya \\ içeremez" >&2; exit 1 ;; esac

# Rewrite in place (cat > keeps owner and mode 600); the value travels via the environment, not argv.
TMP=$(mktemp)
VALUE="$VALUE" awk -v k="$KEY" '
  BEGIN { done = 0 }
  index($0, k "=") == 1 { print k "=\"" ENVIRON["VALUE"] "\""; done = 1; next }
  { print }
  END { if (!done) print k "=\"" ENVIRON["VALUE"] "\"" }' "$FILE" > "$TMP"
cat "$TMP" > "$FILE"
rm -f "$TMP"
echo "$KEY yazıldı → $FILE"
