#!/usr/bin/env bash
# Sets one value in a Casalume .env file without it ever appearing on screen, in argv or in shell history.
# Usage (on hazal, as root):
#   bash /var/www/casalume/app/deploy/hazal/set-secret.sh <backend|ai> <KEY>              # type or paste the value
#   bash /var/www/casalume/app/deploy/hazal/set-secret.sh backend <KEY> --generate        # random 32-byte key, never shown
#   bash /var/www/casalume/app/deploy/hazal/set-secret.sh backend <KEY> --rotate          # KEY → KEY_PREVIOUS, new random KEY
# --generate refuses to overwrite a key that already has a value (an encryption key replaced by mistake would make
# everything sealed with it unreadable); use --rotate, which keeps the old key as KEY_PREVIOUS for decrypting.
set -euo pipefail

case "${1:-}" in
  backend) FILE=/var/www/casalume/app/apps/backend/.env ;;
  ai) FILE=/var/www/casalume/app/apps/ai-service/.env ;;
  *) echo "kullanım: set-secret.sh <backend|ai> <ANAHTAR>" >&2; exit 2 ;;
esac
KEY=${2:-}
MODE=${3:-}
[[ "$KEY" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "geçersiz anahtar adı: '$KEY'" >&2; exit 2; }
[ -f "$FILE" ] || { echo "$FILE yok; önce make-env.sh" >&2; exit 1; }
has_value() { grep -Eq "^$1=\"?[^\"]+" "$FILE"; } # checks only; prints nothing

case "$MODE" in
  --generate)
    if has_value "$KEY"; then echo "$KEY zaten var; üstüne yazılmadı. Anahtarı değiştirmek için: --rotate" >&2; exit 1; fi
    VALUE=$(openssl rand -base64 32)
    ;;
  --rotate)
    has_value "$KEY" || { echo "$KEY yok; önce --generate" >&2; exit 1; }
    # Current value → KEY_PREVIOUS (any older KEY_PREVIOUS is dropped), new random value → KEY; values never echoed.
    NEW=$(openssl rand -base64 32)
    TMP=$(mktemp)
    NEW="$NEW" awk -v k="$KEY" '
      index($0, k "_PREVIOUS=") == 1 { next }
      index($0, k "=") == 1 { v = substr($0, length(k) + 2); print k "_PREVIOUS=" v; print k "=\"" ENVIRON["NEW"] "\""; next }
      { print }' "$FILE" > "$TMP"
    cat "$TMP" > "$FILE"
    rm -f "$TMP"
    echo "$KEY yenilendi; eskisi ${KEY}_PREVIOUS oldu → $FILE"
    exit 0
    ;;
  "")
    read -rsp "$KEY değeri (görünmez): " VALUE
    echo
    ;;
  *) echo "bilinmeyen seçenek: $MODE (--generate | --rotate)" >&2; exit 2 ;;
esac
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
