// Casalume — PM2 processes on the shared server "hazal" (docs/RUNBOOK.md).
// Ports, all on 127.0.0.1 only (nginx is the only public entry): API 4300 · AI 8300 · admin 3300 · web 3301 · Redis 6391.
// Runs under the `casalume` user's own PM2, not root's (the other projects on hazal use root's PM2).
// Settings come from each app's .env / .env.production.local (chmod 600, server only).
const ROOT = "/var/www/casalume";
const APP = `${ROOT}/app`;

module.exports = {
  apps: [
    {
      // Own Redis (BullMQ + rate limits); the server's shared 6379 is left alone.
      name: "casalume-redis",
      script: "redis-server",
      args: `${ROOT}/redis/redis.conf`,
      interpreter: "none",
      autorestart: true,
    },
    {
      name: "casalume-ai",
      cwd: `${APP}/apps/ai-service`,
      script: ".venv/bin/uvicorn",
      args: "app.main:app --host 127.0.0.1 --port 8300 --workers 1 --no-access-log",
      interpreter: "none",
      max_memory_restart: "700M",
      kill_timeout: 15000,
    },
    {
      // API + BullMQ worker in one process (WORKER_ENABLED=true): the server has 2 cores.
      name: "casalume-api",
      cwd: `${APP}/apps/backend`,
      script: "dist/main.js",
      env: { NODE_ENV: "production" },
      max_memory_restart: "700M",
      kill_timeout: 30000,
    },
    {
      name: "casalume-admin",
      cwd: `${APP}/apps/admin`,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3300 -H 127.0.0.1",
      env: { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
      max_memory_restart: "400M",
    },
    {
      name: "casalume-web",
      cwd: `${APP}/apps/web`,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3301 -H 127.0.0.1",
      env: { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
      max_memory_restart: "400M",
    },
  ],
};
