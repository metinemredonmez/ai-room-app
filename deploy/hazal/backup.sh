#!/usr/bin/env bash
# Casalume — daily backup on hazal (cron, as the casalume user): database dump + uploaded/generated images.
# Keeps the last 14 of each, mode 600. A copy off this server is still the owner's call (docs/RUNBOOK.md §7).
set -euo pipefail

ROOT=/var/www/casalume
DEST=$ROOT/backups
STAMP=$(date +%Y%m%d-%H%M)
umask 077

# Split the Prisma URL so the password travels in PGPASSWORD, never in pg_dump's argv (ps) or the log.
DB_URL=$(grep -E '^DATABASE_URL=' "$ROOT/app/apps/backend/.env" | cut -d= -f2- | tr -d '"')
re='^postgresql://([^:]+):([^@]+)@([^:/]+):([0-9]+)/([^?]+)'
[[ $DB_URL =~ $re ]] || { echo "DATABASE_URL okunamadı" >&2; exit 1; }
PGPASSWORD=${BASH_REMATCH[2]} pg_dump --format=custom -h "${BASH_REMATCH[3]}" -p "${BASH_REMATCH[4]}" \
  -U "${BASH_REMATCH[1]}" -d "${BASH_REMATCH[5]}" > "$DEST/db-$STAMP.dump"

if [ -d "$ROOT/data/images" ]; then
  tar -C "$ROOT/data" -czf "$DEST/images-$STAMP.tar.gz" images
fi

ls -1t "$DEST"/db-*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$DEST"/images-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "$(date -Is) yedek tamam: db-$STAMP.dump"
