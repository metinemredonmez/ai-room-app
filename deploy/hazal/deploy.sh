#!/usr/bin/env bash
# Casalume — updates hazal without breaking the live site. Run as the casalume user:
#   sudo -iu casalume bash /var/www/casalume/app/deploy/hazal/deploy.sh          # only apps changed since their last deploy
#   sudo -iu casalume bash /var/www/casalume/app/deploy/hazal/deploy.sh --all    # every app
# Full output goes to /var/www/casalume/deploy.log; on failure the last lines are shown and nothing else is switched.
#
# Why: `next build` empties .next while `next start` is still serving from it, so pages and their scripts failed
# (404/500) for the minutes the build took (6 Nov 2026). Admin and web now build into the idle folder of two
# (.next-a / .next-b); .next is a symlink to the live one. Only after a successful build is the symlink switched and
# that one app reloaded, so the site is down only for the restart itself. The previous build's static files are copied
# into the new one, so a page already open in a browser can still load its scripts.
set -Eeuo pipefail
{ # bash reads the whole block before running it: the git pull below may replace this very file

ROOT=/var/www/casalume
APP=$ROOT/app
LOG=$ROOT/deploy.log
STATE=$ROOT/.deployed
[ "$(id -un)" = casalume ] || { echo "casalume kullanıcısıyla çalıştır: sudo -iu casalume bash $0" >&2; exit 1; }

# The work runs in its own session, so a dropped ssh connection or Ctrl-C cannot stop it halfway (a write to a closed
# terminal would kill it). This part only takes the lock, shows the output and returns the exit code.
if [ "${CASALUME_DEPLOY_CHILD:-}" != 1 ]; then
  exec 9>"$ROOT/.deploy.lock"
  flock -n 9 || { echo "Başka bir yayın sürüyor." >&2; exit 1; }
  OUT=$ROOT/deploy.out
  : > "$OUT"
  CASALUME_DEPLOY_CHILD=1 setsid -w bash "$0" "$@" >"$OUT" 2>&1 </dev/null & # inherits fd 9: the lock lasts as long as the work
  child=$!
  echo "(Bağlantı koparsa yayın sürer; çıktı: $OUT)"
  tail -n +1 -f --pid="$child" "$OUT" || true
  if wait "$child"; then exit 0; else exit $?; fi
fi

ALL=0
[ "${1:-}" = "--all" ] && ALL=1

: > "$LOG"
trap 'echo "HATA — son satırlar ($LOG):" >&2; tail -n 30 "$LOG" >&2' ERR
step() { echo "== $1 $(date +%H:%M:%S)" | tee -a "$LOG"; }
export NEXT_TELEMETRY_DISABLED=1
mkdir -p "$STATE"

step "git pull"
git -C "$APP" pull --ff-only >>"$LOG" 2>&1
HEAD=$(git -C "$APP" rev-parse HEAD)
echo "   commit $(git -C "$APP" log -1 --format='%h %s')"

# changed <app> <path>… : true when the paths differ between this app's last deployed commit and HEAD (or always with --all / first run).
changed() {
  local app=$1; shift
  [ "$ALL" = 1 ] && return 0
  [ -f "$STATE/$app" ] || return 0
  git -C "$APP" cat-file -e "$(cat "$STATE/$app")^{commit}" 2>/dev/null || return 0
  ! git -C "$APP" diff --quiet "$(cat "$STATE/$app")" "$HEAD" -- "$@"
}
done_app() { echo "$HEAD" > "$STATE/$1"; }
deps() { # npm ci only when the lockfile changed (it empties node_modules under the running process)
  local app=$1
  if [ ! -d node_modules ] || changed "$app" "apps/$app/package-lock.json"; then npm ci --no-audit --no-fund >>"$LOG" 2>&1; fi
}
wait_up() { # wait_up <port> <path>: the reloaded app answers (2xx/3xx) within 60 s
  local code
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$1$2" || true)
    case "$code" in 2??|3??) echo "   yanıt $code"; return 0 ;; esac
    sleep 1
  done
  echo "   $1$2 60 sn içinde yanıt vermedi (son kod $code)" | tee -a "$LOG" >&2
  return 1
}

if changed backend apps/backend; then
  step backend
  cd "$APP/apps/backend"
  deps backend
  { npx prisma generate && npm run build && npm run db:migrate; } >>"$LOG" 2>&1
  pm2 reload casalume-api --update-env >>"$LOG" 2>&1
  wait_up 4300 /v1/health
  done_app backend
fi

if changed ai-service apps/ai-service; then
  step ai-service
  cd "$APP/apps/ai-service"
  if [ ! -d .venv ] || changed ai-service apps/ai-service/uv.lock apps/ai-service/pyproject.toml; then uv sync --frozen --no-dev >>"$LOG" 2>&1; fi
  pm2 reload casalume-ai --update-env >>"$LOG" 2>&1
  wait_up 8300 /healthz
  done_app ai-service
fi

# release_next <app> <pm2 name> <port> <path to check>
release_next() {
  local app=$1 name=$2 port=$3 path=$4 live="" target prev=""
  step "$app"
  cd "$APP/apps/$app"
  deps "$app"
  [ -L .next ] && live=$(readlink .next)
  if [ "$live" = .next-a ]; then target=.next-b; else target=.next-a; fi
  rm -rf "$target"
  NEXT_DIST_DIR="$target" npm run build >>"$LOG" 2>&1 # NEXT_DIST_DIR only for the build; `next start` keeps .next
  if [ -n "$live" ]; then prev=$live; elif [ -d .next ]; then prev=.next; fi
  if [ -n "$prev" ] && [ -d "$prev/static" ]; then rsync -a --ignore-existing "$prev/static/" "$target/static/"; fi
  ln -sfn "$target" .next.tmp
  [ -d .next ] && [ ! -L .next ] && mv .next .next-old # first run: the old real folder makes way for the symlink
  mv -T .next.tmp .next
  pm2 reload "$name" --update-env >>"$LOG" 2>&1
  wait_up "$port" "$path"
  rm -rf .next-old
  done_app "$app"
}

if changed admin apps/admin; then release_next admin casalume-admin 3300 /login; fi
if changed web apps/web; then release_next web casalume-web 3301 /; fi

step bitti
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s))if(p.name.startsWith("casalume"))console.log(`   ${p.name} ${p.pm2_env.status} ↻${p.pm2_env.restart_time} ${Math.round((Date.now()-p.pm2_env.pm_uptime)/1000)} sn`)})'
exit 0
}
