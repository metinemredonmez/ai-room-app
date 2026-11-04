// Owner decision (4 Nov 2026, docs/RUNBOOK.md): admin logins through the admin panel skip the 6-digit code,
// direct logins against the API don't. Kept apart from smoke.mjs because admin logins are rate limited (5 per
// 15 min per IP). Needs a backend started with ADMIN_DEV_SKIP_MFA=false and ADMIN_PANEL_KEY=$SMOKE_PANEL_KEY.
//   SMOKE_PANEL_KEY=… node scripts/smoke-panel.mjs
import { readFile } from 'node:fs/promises';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000/v1';
const KEY = process.env.SMOKE_PANEL_KEY;
if (!KEY) {
  console.error('SMOKE_PANEL_KEY gerekli');
  process.exit(2);
}
const creds = Object.fromEntries(
  (await readFile(new URL('../apps/backend/data/admin-credentials.txt', import.meta.url), 'utf8'))
    .trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const login = async (headers) => {
  const res = await fetch(`${API}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const direct = await login({});
const wrongKey = await login({ 'x-admin-panel-key': `${KEY}x` });
const viaPanel = await login({ 'x-admin-panel-key': KEY });
const me = await fetch(`${API}/admin/me`, { headers: { authorization: `Bearer ${viaPanel.json?.accessToken}` } });
const pass = direct.status === 401 && wrongKey.status === 401 && viaPanel.status === 201 && me.status === 200;
console.log(`${pass ? '✓' : '✗'} panel login needs no code; direct API login still does — ${direct.status}/${wrongKey.status}/${viaPanel.status}/${me.status}`);
process.exit(pass ? 0 : 1);
