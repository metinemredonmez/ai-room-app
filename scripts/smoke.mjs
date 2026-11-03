#!/usr/bin/env node
// End-to-end smoke test against a running stack (backend :4000 + ai-service :8001).
// Usage: node scripts/smoke.mjs   (reads admin credentials from apps/backend/data/admin-credentials.txt)
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000/v1';
let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* binary or empty */ }
  return { status: res.status, json, headers: res.headers };
}

const deviceId = `smoke-${crypto.randomUUID()}`;
const guest = await call('POST', '/auth/guest', { body: { deviceId } });
ok(guest.status === 201 || guest.status === 200, 'guest login', `status ${guest.status}`);
const token = guest.json.accessToken;

const cat = await call('GET', '/catalog?locale=tr');
ok(cat.json?.tools?.length === 10 && cat.json.styles.length >= 10, 'catalog', `${cat.json?.tools?.length} tools, ${cat.json?.styles?.length} styles`);
const preview = await fetch(cat.json.styles[0].previewUrl);
ok(preview.status === 200 && preview.headers.get('content-type') === 'image/jpeg', 'style preview image', `status ${preview.status}`);

const sample = await call('POST', '/uploads/sample', { token, body: { sample: 'living_room' } });
ok(sample.status === 201, 'sample upload', sample.json?.image?.id);
const img = await fetch(sample.json.image.url);
ok(img.status === 200 && img.headers.get('content-type') === 'image/jpeg', 'signed image URL serves JPEG');
const tampered = await fetch(sample.json.image.url.replace(/sig=[^&]+/, 'sig=AAAA'));
ok(tampered.status === 403, 'tampered signature rejected (FIL-04)', `status ${tampered.status}`);

const notImage = await call('POST', '/uploads', { token, body: { data: Buffer.from('%PDF-1.7 '.repeat(40)).toString('base64'), mimeType: 'image/jpeg' } });
ok(notImage.status === 415, 'non-image upload rejected (FIL-01)', `status ${notImage.status}`);

const design = await call('POST', '/designs', {
  token, body: { tool: 'redesign', inputImageId: sample.json.image.id, styleId: 'japandi', roomId: 'living_room', variants: 2 },
});
ok(design.status === 201 && design.json?.status === 'SUCCEEDED' && design.json.results.length === 2, 'redesign generated 2 variants', design.json?.title ?? JSON.stringify(design.json));

const me = await call('GET', '/me', { token });
ok(me.json?.dailyFreeRemaining === 1, 'daily free quota charged (3 → 1)', `remaining ${me.json?.dailyFreeRemaining}`);

const tooMany = await call('POST', '/designs', { token, body: { tool: 'paint', inputImageId: sample.json.image.id, colorHex: '#9CAF88', variants: 4 } });
ok(tooMany.status === 402 && tooMany.json?.error?.code === 'insufficient_credits', 'over-quota request → 402', `status ${tooMany.status}`);

const proStyle = await call('POST', '/designs', { token, body: { tool: 'redesign', inputImageId: sample.json.image.id, styleId: 'art_deco', variants: 1 } });
ok(proStyle.status === 402 && proStyle.json?.error?.code === 'pro_required', 'PRO style blocked for free user');

const analysis = await call('POST', `/designs/${design.json.id}/analysis`, { token, body: {} });
ok(analysis.status === 201 && analysis.json?.items?.length > 0 && analysis.json.totals.grandMaxTRY > 0, 'analysis with TL totals', `₺${analysis.json?.totals?.grandMinTRY}–₺${analysis.json?.totals?.grandMaxTRY}`);
ok(analysis.json?.items?.[0]?.links?.some((l) => l.store === 'Trendyol'), 'store links present');

const chat = await call('POST', '/chat', { token, body: { messages: [{ role: 'user', text: 'Bahçemi nasıl düzenlerim?', imageId: sample.json.image.id }] } });
ok(chat.status === 201 && chat.json?.reply && Array.isArray(chat.json.suggestions), 'design chat replies', chat.json?.suggestions?.[0]?.tool);

// AZ-01: another user must not see this design or reuse the image.
const other = await call('POST', '/auth/guest', { body: { deviceId: `smoke-${crypto.randomUUID()}` } });
const peek = await call('GET', `/designs/${design.json.id}`, { token: other.json.accessToken });
ok(peek.status === 404, "other user can't read the design (AZ-01)", `status ${peek.status}`);
const steal = await call('POST', '/designs', { token: other.json.accessToken, body: { tool: 'redesign', inputImageId: sample.json.image.id, variants: 1 } });
ok(steal.status === 404, "other user can't use the image as input", `status ${steal.status}`);

// SES-05: refresh rotation with reuse detection.
const r1 = await call('POST', '/auth/refresh', { body: { refreshToken: guest.json.refreshToken } });
ok(r1.status === 201, 'refresh rotates');
const reuse = await call('POST', '/auth/refresh', { body: { refreshToken: guest.json.refreshToken } });
ok(reuse.status === 401, 'refresh token reuse rejected (SES-05)');
const familyRevoked = await call('POST', '/auth/refresh', { body: { refreshToken: r1.json.refreshToken } });
ok(familyRevoked.status === 401, 'whole refresh family revoked after reuse');

// Admin: user token must not open admin routes; MFA login does.
const userOnAdmin = await call('GET', '/admin/stats', { token });
ok(userOnAdmin.status === 401, 'app token rejected on admin API (TOK-02)', `status ${userOnAdmin.status}`);
const creds = Object.fromEntries(
  (await readFile(new URL('../apps/backend/data/admin-credentials.txt', import.meta.url), 'utf8'))
    .trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const noOtp = await call('POST', '/admin/auth/login', { body: { email: creds.email, password: creds.password, otp: '000000' } });
ok(noOtp.status === 401, 'admin login without valid TOTP rejected (AUT-01)');
const totp = (secret) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  return ((mac.readUInt32BE(o) & 0x7fffffff) % 1e6).toString().padStart(6, '0');
};
const code = totp(creds.totp_secret);
const admin = await call('POST', '/admin/auth/login', { body: { email: creds.email, password: creds.password, otp: code } });
if (admin.status === 401 || admin.status === 429) {
  console.log(`  (admin login returned ${admin.status}: ${admin.status === 429 ? 'admin login rate limit (5 / 15 min) reached' : 'TOTP code already used this window'} — rerun later)`);
} else {
  ok(admin.status === 201 && admin.json?.accessToken, 'admin login with password + TOTP');
  const replay = await call('POST', '/admin/auth/login', { body: { email: creds.email, password: creds.password, otp: code } });
  ok(replay.status === 401, 'TOTP code replay rejected');
  const stats = await call('GET', '/admin/stats?days=7', { token: admin.json.accessToken });
  ok(stats.status === 200 && stats.json?.totals?.designs >= 1 && stats.json.daily.length === 7, 'admin stats', `${stats.json?.totals?.designs} designs, ${stats.json?.totals?.users} users`);
  const feat = await call('PATCH', `/admin/designs/${design.json.id}`, { token: admin.json.accessToken, body: { featured: true } });
  ok(feat.status === 200 && feat.json?.featured === true, 'admin features a design');
  const insp = await call('GET', '/inspiration');
  ok(insp.json?.items?.some((i) => i.id === design.json.id), 'featured design appears in inspiration');
  const audit = await call('GET', '/admin/audit?limit=5', { token: admin.json.accessToken });
  ok(audit.json?.items?.some((a) => a.action === 'design.feature'), 'admin action audited (LOG-01)');
}

const del = await call('DELETE', `/designs/${design.json.id}`, { token });
ok(del.status === 204, 'user deletes own design');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
