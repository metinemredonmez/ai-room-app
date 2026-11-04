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

// API.md §7.8: local edits are region-locked (heuristic mask in mock mode, SAM 3 with FAL_KEY).
const otherSample = await call('POST', '/uploads/sample', { token: other.json.accessToken, body: { sample: 'living_room' } });
const painted = await call('POST', '/designs', {
  token: other.json.accessToken, body: { tool: 'paint', inputImageId: otherSample.json?.image?.id, colorHex: '#9CAF88', variants: 1 },
});
ok(painted.status === 201 && painted.json?.region?.applied === true && painted.json.region.target === 'wall',
  'paint is region-locked (§7.8)', `${painted.json?.region?.method} · coverage ${painted.json?.region?.coverage}`);

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
let adminToken = null;
const code = totp(creds.totp_secret);
const admin = await call('POST', '/admin/auth/login', { body: { email: creds.email, password: creds.password, otp: code } });
if (admin.status === 401 || admin.status === 429) {
  console.log(`  (admin login returned ${admin.status}: ${admin.status === 429 ? 'admin login rate limit (5 / 15 min) reached' : 'TOTP code already used this window'} — rerun later)`);
} else {
  ok(admin.status === 201 && admin.json?.accessToken, 'admin login with password + TOTP');
  adminToken = admin.json?.accessToken ?? null;
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

// AUT-03 / MAIL-01 / SES-04: e-mail verification and password reset (dev outbox transport).
const outboxDir = new URL('../apps/backend/data/outbox/', import.meta.url);
const { readdir } = await import('node:fs/promises');
const lastMailTo = async (to, subjectPart) => {
  for (let i = 0; i < 20; i++) {
    const files = (await readdir(outboxDir).catch(() => [])).sort().reverse();
    for (const f of files) {
      const m = JSON.parse(await readFile(new URL(f, outboxDir), 'utf8'));
      if (m.to === to && m.subject.includes(subjectPart)) return m;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
};
const tokenFrom = (mail) => mail?.text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
const userEmail = `smoke-${Date.now()}@example.com`;
const reg = await call('POST', '/auth/register', { body: { email: userEmail, password: 'first-password-123' } });
ok(reg.status === 201 && reg.json?.user?.emailVerified === false, 'register → unverified e-mail');
const verifyMail = await lastMailTo(userEmail, 'doğrula');
ok(verifyMail?.text.includes('http://localhost:3000/eposta-dogrula#token='), 'verification mail uses the configured origin + fragment (MAIL-01)');
const verified = await call('POST', '/auth/email/verify', { body: { token: tokenFrom(verifyMail) } });
ok(verified.status === 201, 'e-mail verified');
const meVerified = await call('GET', '/me', { token: reg.json.accessToken });
ok(meVerified.json?.emailVerified === true, 'user now shows emailVerified');
const verifyAgain = await call('POST', '/auth/email/verify', { body: { token: tokenFrom(verifyMail) } });
ok(verifyAgain.status === 400 && verifyAgain.json?.error?.code === 'invalid_token', 'verification token is single-use');

const unknown = await call('POST', '/auth/password/forgot', { body: { email: `nobody-${Date.now()}@example.com` } });
const known = await call('POST', '/auth/password/forgot', { body: { email: userEmail }, headers: { 'x-forwarded-host': 'evil.example', host: 'evil.example' } });
ok(unknown.status === 202 && known.status === 202 && JSON.stringify(unknown.json) === JSON.stringify(known.json), 'forgot-password answers identically for unknown addresses');
const resetMail = await lastMailTo(userEmail, 'Şifre');
ok(resetMail && !resetMail.text.includes('evil.example') && resetMail.text.includes('/sifre-sifirla#token='), 'reset link ignores spoofed Host headers (MAIL-01)');
const resetToken = tokenFrom(resetMail);
const wrongPurpose = await call('POST', '/auth/email/verify', { body: { token: resetToken } });
ok(wrongPurpose.status === 400, 'reset token rejected for another purpose (AUT-03)');
const reset = await call('POST', '/auth/password/reset', { body: { token: resetToken, password: 'second-password-456' } });
ok(reset.status === 204, 'password reset with token');
const replayReset = await call('POST', '/auth/password/reset', { body: { token: resetToken, password: 'third-password-789' } });
ok(replayReset.status === 400, 'reset token cannot be reused');
const oldSession = await call('GET', '/me', { token: reg.json.accessToken });
const oldRefresh = await call('POST', '/auth/refresh', { body: { refreshToken: reg.json.refreshToken } });
ok(oldSession.status === 401 && oldRefresh.status === 401, 'all sessions revoked after reset (SES-04)');
const oldPw = await call('POST', '/auth/login', { body: { email: userEmail, password: 'first-password-123' } });
const newPw = await call('POST', '/auth/login', { body: { email: userEmail, password: 'second-password-456' } });
ok(oldPw.status === 401 && newPw.status === 201, 'old password rejected, new password works');

// ---------------------------------------------------------------- v1.1: queue, settings, KVKK, reports
const v11 = await call('POST', '/auth/guest', { body: { deviceId: `smoke-${crypto.randomUUID()}` } });
const vt = v11.json.accessToken;
const vSample = await call('POST', '/uploads/sample', { token: vt, body: { sample: 'bedroom' } });
ok('quality' in (vSample.json ?? {}) || vSample.status === 201, 'upload response carries the quality field');
const realJpeg = (await (await fetch(vSample.json.image.url)).arrayBuffer());
const up = await call('POST', '/uploads', { token: vt, body: { data: Buffer.from(realJpeg).toString('base64'), mimeType: 'image/jpeg' } });
ok(up.status === 201 && 'quality' in up.json, 'upload returns advisory quality', JSON.stringify(up.json?.quality));

// #5 "Tasarımın hazır" push: only Expo tokens are accepted; queued designs push to every device of the owner.
const pushToken = `ExponentPushToken[smoke${Date.now()}]`;
const badPush = await call('POST', '/me/push-tokens', { token: vt, body: { token: 'https://evil.example/hook', platform: 'ios' } });
ok(badPush.status === 400, 'non-Expo push token rejected', `status ${badPush.status}`);
const regPush = await call('POST', '/me/push-tokens', { token: vt, body: { token: pushToken, platform: 'ios' } });
ok(regPush.status === 204, 'push token registered', `status ${regPush.status}`);

const idemKey = `smoke-${Date.now()}`;
const asyncBody = { tool: 'redesign', inputImageId: vSample.json.image.id, styleId: 'scandinavian', roomId: 'bedroom', variants: 1 };
const a1 = await call('POST', '/designs', { token: vt, body: asyncBody, headers: { prefer: 'respond-async', 'idempotency-key': idemKey } });
ok(a1.status === 202 && a1.json?.status === 'PENDING' && a1.json.chargeState === 'HELD', 'async design → 202 PENDING with credits HELD');
const a2 = await call('POST', '/designs', { token: vt, body: asyncBody, headers: { prefer: 'respond-async', 'idempotency-key': idemKey } });
ok(a2.status === 200 && a2.json?.id === a1.json.id, 'same Idempotency-Key returns the same design (no second charge)');
let polled = null;
for (let i = 0; i < 40; i++) {
  polled = await call('GET', `/designs/${a1.json.id}`, { token: vt });
  if (polled.json?.status !== 'PENDING') break;
  await new Promise((r) => setTimeout(r, 500));
}
ok(polled?.json?.status === 'SUCCEEDED' && polled.json.chargeState === 'CAPTURED' && polled.json.results.length === 1, 'queued design completed by the worker, credits CAPTURED');
const pushDir = new URL('../apps/backend/data/push-outbox/', import.meta.url);
let pushed = null;
for (let i = 0; i < 40 && !pushed; i++) {
  for (const f of (await readdir(pushDir).catch(() => [])).sort().reverse()) {
    const m = JSON.parse(await readFile(new URL(f, pushDir), 'utf8'));
    if (m.to === pushToken && m.data?.designId === a1.json.id) { pushed = m; break; }
  }
  if (!pushed) await new Promise((r) => setTimeout(r, 250));
}
ok(pushed?.title === 'Tasarımın hazır' && pushed.data.url === `casalume://design/${a1.json.id}`, '"Tasarımın hazır" push sent for the queued design', pushed?.body);
const moved = await call('POST', '/me/push-tokens', { token: other.json.accessToken, body: { token: pushToken, platform: 'ios' } });
const strangerDelete = await call('DELETE', '/me/push-tokens', { token: vt, body: { token: pushToken } });
ok(moved.status === 204 && strangerDelete.status === 204, 'same device on another account moves the token (old account no longer owns it)');

const vMe = await call('GET', '/me', { token: vt });
ok(vMe.json?.dailyFreeRemaining === 2, 'idempotent retry charged once (3 → 2)', `remaining ${vMe.json?.dailyFreeRemaining}`);

const consents = await call('GET', '/me/consents', { token: vt });
ok(consents.status === 200 && consents.json?.current?.ai_processing?.granted === false, 'consents start ungranted');
const badVersion = await call('POST', '/me/consents', { token: vt, body: { kind: 'ai_processing', version: '1999-01-01', granted: true } });
ok(badVersion.status === 409, 'stale consent version rejected');
const catalog2 = await call('GET', '/catalog');
ok(catalog2.json?.legal?.aiProcessingVersion && catalog2.json.maintenance?.enabled === false, 'catalog exposes legal versions + maintenance');

const report = await call('POST', `/designs/${a1.json.id}/report`, { token: vt, body: { reason: 'inappropriate', note: 'smoke' } });
ok(report.status === 201 && report.json?.status === 'OPEN', 'user reports an AI result (Google Play policy)');
const strangerReport = await call('POST', `/designs/${a1.json.id}/report`, { token: other.json.accessToken, body: { reason: 'other' } });
ok(strangerReport.status === 404, "can't report someone else's non-featured design");

const exp = await call('GET', '/me/export', { token: vt });
ok(exp.status === 200 && exp.json?.designs?.length >= 1 && exp.headers.get('content-disposition')?.includes('attachment'), 'KVKK data export downloads JSON');
ok(Array.isArray(exp.json?.pushDevices) && exp.json.pushDevices.length === 0, 'export lists push devices (moved token no longer listed)');
ok(Array.isArray(exp.json?.signInMethods), 'export lists linked sign-in methods');

// KVKK legal texts + m.11 applications (#9).
const legalIndex = await call('GET', '/legal?locale=en');
const aiText = legalIndex.json?.items?.find((d) => d.kind === 'ai_processing');
ok(legalIndex.status === 200 && legalIndex.json.items.length === 4 && aiText?.version === catalog2.json?.legal?.aiProcessingVersion, 'legal index matches the catalog versions');
const privacyEn = await call('GET', '/legal/privacy?locale=en');
ok(privacyEn.status === 200 && privacyEn.json?.locale === 'en' && privacyEn.json.format === 'markdown' && !privacyEn.json.body.includes('{{'), 'privacy notice served with the controller details filled in');
const legalMissing = await call('GET', '/legal/cookies');
const legalBadVersion = await call('GET', '/legal/privacy?version=latest');
const legalOld = await call('GET', '/legal/privacy?version=1999-01-01');
ok(legalMissing.status === 404 && legalBadVersion.status === 400 && legalOld.status === 404, 'unknown kind, malformed and unpublished versions are refused');
const drBad = await call('POST', '/me/data-requests', { token: vt, body: { type: 'access', details: 'smoke kvkk', status: 'COMPLETED' } });
ok(drBad.status === 400, 'data request body is validated strictly (no client-set status)');
const dr = await call('POST', '/me/data-requests', { token: vt, body: { type: 'access', details: 'smoke: verilerimin bir kopyasını istiyorum' } });
const drDays = (new Date(dr.json?.dueAt) - new Date(dr.json?.receivedAt)) / 86_400_000;
ok(dr.status === 201 && /^KVKK-\d{4}-[A-Z2-9]{6}$/.test(dr.json?.reference ?? '') && dr.json.status === 'RECEIVED' && drDays === 30, 'KVKK m.11 application filed with a 30-day deadline', dr.json?.reference);
const drMine = await call('GET', '/me/data-requests', { token: vt });
const drOther = await call('GET', '/me/data-requests', { token: other.json.accessToken });
ok(drMine.json?.items?.some((r) => r.id === dr.json.id) && !drOther.json?.items?.some((r) => r.id === dr.json.id), "applications are listed to their owner only (AZ-01)");
const exp2 = await call('GET', '/me/export', { token: vt });
ok(exp2.json?.dataRequests?.some((r) => r.reference === dr.json.reference), 'export includes KVKK applications');
const drNoAdmin = await call('GET', '/admin/data-requests', { token: vt });
ok(drNoAdmin.status === 401 || drNoAdmin.status === 403, 'a user cannot open the application desk', `${drNoAdmin.status}`);

// Apple / Google sign-in (#7). Without client ids the providers answer 503; a configured one rejects junk with 401.
const nonceRes = await call('POST', '/auth/oauth/nonce');
ok(nonceRes.status === 201 && /^[A-Za-z0-9_-]{43}$/.test(nonceRes.json?.nonce ?? ''), 'sign-in nonce issued (TOK-03)');
const junkToken = `eyJ${'a'.repeat(150)}.${'b'.repeat(60)}.${'c'.repeat(40)}`;
for (const [provider, body] of [['google', { idToken: junkToken, nonce: nonceRes.json?.nonce }], ['apple', { identityToken: junkToken, nonce: nonceRes.json?.nonce }]]) {
  const r = await call('POST', `/auth/oauth/${provider}`, { body });
  ok((r.status === 503 && r.json?.error?.code === 'oauth_not_configured') || (r.status === 401 && r.json?.error?.code === 'invalid_token'), `${provider} sign-in refuses an unverifiable token`, `${r.status} ${r.json?.error?.code}`);
}
const badShape = await call('POST', '/auth/oauth/apple', { body: { identityToken: junkToken, nonce: 'short', extra: 1 } });
ok(badShape.status === 400, 'sign-in body is validated strictly');
const appleEvent = await call('POST', '/webhooks/apple', { body: { payload: junkToken } });
ok(appleEvent.status === 503 || appleEvent.status === 401, 'Apple server event is verified before anything is written', `${appleEvent.status}`);
const ids = await call('GET', '/me/identities', { token: vt });
ok(ids.status === 200 && Array.isArray(ids.json?.items) && typeof ids.json?.hasPassword === 'boolean', 'linked sign-in methods listed');
const unlinkNone = await call('DELETE', '/me/identities/apple', { token: vt });
const unlinkBad = await call('DELETE', '/me/identities/github', { token: vt });
ok(unlinkNone.status === 404 && unlinkBad.status === 400, 'unlinking an unknown or unlinked provider is refused');

if (adminToken) {
  const A = { token: adminToken };
  const st = await call('GET', '/admin/settings', A);
  ok(st.status === 200 && st.json?.values?.freeDailyGenerations >= 0, 'admin reads runtime settings');
  const noReason = await call('PATCH', '/admin/settings', { ...A, body: { values: { maxVariantsFree: 1 } } });
  ok(noReason.status === 400, 'settings change without a reason is rejected');
  const maint = await call('PATCH', '/admin/settings', { ...A, body: { values: { maintenance: { ...st.json.values.maintenance, enabled: true }, requireAiConsent: true }, reason: 'smoke test' } });
  ok(maint.status === 200 && maint.json?.values?.maintenance?.enabled === true, 'admin enables maintenance + consent requirement');
  const during = await call('POST', '/designs', { token: vt, body: { ...asyncBody, variants: 1 } });
  ok(during.status === 503 && during.json?.error?.code === 'busy', 'maintenance blocks generation (503)');
  await call('PATCH', '/admin/settings', { ...A, body: { values: { maintenance: { ...st.json.values.maintenance, enabled: false } }, reason: 'smoke test' } });
  const noConsent = await call('POST', '/designs', { token: vt, body: asyncBody });
  ok(noConsent.status === 403 && noConsent.json?.error?.code === 'consent_required', 'requireAiConsent enforces KVKK consent (403)');
  const give = await call('POST', '/me/consents', { token: vt, body: { kind: 'ai_processing', version: catalog2.json.legal.aiProcessingVersion, granted: true } });
  const withConsent = await call('POST', '/designs', { token: vt, body: asyncBody });
  ok(give.status === 201 && withConsent.status === 201, 'after consent the design succeeds');
  await call('PATCH', '/admin/settings', { ...A, body: { values: { requireAiConsent: st.json.values.requireAiConsent }, reason: 'smoke test revert' } });

  // Force update (#8): an iOS build below the minimum gets 426 + store link; web and current builds pass.
  const versions = st.json.values.appVersions;
  const ios = (version) => ({ 'x-app-platform': 'ios', 'x-app-version': version });
  const badStore = await call('PATCH', '/admin/settings', { ...A, body: { values: { appVersions: { ...versions, ios: { min: '1.2.0', latest: '1.3.0', storeUrl: 'https://evil.example.com/app' } } }, reason: 'smoke force update' } });
  ok(badStore.status === 400, 'store link must be an official store URL');
  const setMin = await call('PATCH', '/admin/settings', { ...A, body: { values: { appVersions: { ...versions, ios: { min: '1.2.0', latest: '1.3.0', storeUrl: 'https://apps.apple.com/app/id1' } } }, reason: 'smoke force update' } });
  ok(setMin.status === 200, 'admin sets a minimum iOS version');
  const old = await call('GET', '/catalog', { token: vt, headers: ios('1.1.9') });
  ok(old.status === 426 && old.json?.error?.code === 'update_required' && old.json.error.storeUrl === 'https://apps.apple.com/app/id1' && old.json.error.minVersion === '1.2.0', 'outdated iOS build gets 426 update_required');
  const current = await call('GET', '/catalog', { headers: ios('1.2.0') });
  const web = await call('GET', '/catalog');
  ok(current.status === 200 && web.status === 200, 'current build and web are not gated');
  const check = await call('GET', '/app/version?platform=ios&version=1.1.0', { headers: ios('1.1.0') });
  ok(check.status === 200 && check.json?.updateRequired === true && check.json.updateAvailable === true && check.json.latestVersion === '1.3.0', 'version check stays reachable for an outdated build');
  await call('PATCH', '/admin/settings', { ...A, body: { values: { appVersions: versions }, reason: 'smoke test revert' } });

  // KVKK desk (#9): deadline-ordered list, answer required to close, the applicant sees the answer.
  const desk = await call('GET', '/admin/data-requests?status=RECEIVED&limit=100', A);
  ok(desk.status === 200 && typeof desk.json?.counts?.overdue === 'number' && desk.json.items.some((r) => r.id === dr.json.id && r.daysLeft === 30), 'admin sees the application with days left');
  const noAnswer = await call('PATCH', `/admin/data-requests/${dr.json.id}`, { ...A, body: { status: 'COMPLETED' } });
  const working = await call('PATCH', `/admin/data-requests/${dr.json.id}`, { ...A, body: { status: 'IN_PROGRESS' } });
  const closed = await call('PATCH', `/admin/data-requests/${dr.json.id}`, { ...A, body: { status: 'COMPLETED', response: 'smoke: verilerinin kopyası e-postana gönderildi' } });
  const reopen = await call('PATCH', `/admin/data-requests/${dr.json.id}`, { ...A, body: { status: 'IN_PROGRESS' } });
  ok(noAnswer.status === 400 && working.status === 200 && closed.status === 200 && closed.json?.closedAt && reopen.status === 409, 'application closes only with an answer and stays closed');
  const drAfter = await call('GET', '/me/data-requests', { token: vt });
  ok(drAfter.json?.items?.find((r) => r.id === dr.json.id)?.response?.startsWith('smoke:'), 'applicant sees the answer');
  const manual = await call('POST', '/admin/data-requests', { ...A, body: { type: 'erasure', channel: 'kep', details: 'smoke: KEP ile gelen silme talebi', receivedAt: new Date(Date.now() - 31 * 86_400_000).toISOString() } });
  ok(manual.status === 201 && manual.json?.overdue === true, 'application received by KEP is logged with its arrival date (overdue)');
  if (manual.json?.id) await call('PATCH', `/admin/data-requests/${manual.json.id}`, { ...A, body: { status: 'REJECTED', response: 'smoke: test kaydı kapatıldı' } });

  const texts = await call('GET', '/admin/legal', A);
  ok(texts.status === 200 && texts.json?.items?.filter((r) => r.status === 'published').length >= 8, 'admin lists the legal text versions');
  const draftBody = { kind: 'marketing', version: '2099-12-31', locale: 'tr', title: 'Smoke taslak', body: 'Smoke testi için geçici taslak metin. '.repeat(3), requiresConsent: false };
  const htmlDraft = await call('POST', '/admin/legal', { ...A, body: { ...draftBody, body: `${draftBody.body}<script>alert(1)</script>` } });
  const draft = await call('POST', '/admin/legal', { ...A, body: draftBody });
  const draftEdit = await call('PATCH', `/admin/legal/${draft.json?.id}`, { ...A, body: { title: 'Smoke taslak 2' } });
  const liveEdit = await call('PATCH', `/admin/legal/${texts.json?.items?.find((r) => r.status === 'published')?.id}`, { ...A, body: { title: 'Değişti' } });
  const draftDel = await call('DELETE', `/admin/legal/${draft.json?.id}`, A);
  ok(htmlDraft.status === 400 && draft.status === 201 && draftEdit.status === 200 && liveEdit.status === 409 && draftDel.status === 204, 'drafts are editable, published texts are not, HTML is refused');
  const publishNoDraft = await call('POST', '/admin/legal/publish', { ...A, body: { kind: 'marketing', version: '2099-12-31', reason: 'smoke' } });
  ok(publishNoDraft.status === 400, 'nothing to publish without a Turkish draft');
  const kvkkAudit = await call('GET', '/admin/audit?limit=30', A);
  const kvkkActions = new Set((kvkkAudit.json?.items ?? []).map((a) => a.action));
  ok(['kvkk.request_update', 'kvkk.request_create', 'legal.draft_create', 'legal.draft_delete'].every((a) => kvkkActions.has(a)) && !JSON.stringify(kvkkAudit.json).includes('smoke: verilerinin'), 'KVKK actions are audited without the answer text');

  const usage = await call('GET', '/admin/ai/usage?days=7', A);
  ok(usage.status === 200 && usage.json?.budget?.state && usage.json.daily.length === 7 && usage.json.today.calls >= 1, 'AI cost ledger + budget state', `today calls ${usage.json?.today?.calls}, $${usage.json?.today?.costUsd}`);
  const reports = await call('GET', '/admin/reports?status=OPEN', A);
  ok(reports.json?.items?.some((r) => r.id === report.json.id), 'admin sees the open report');
  const resolved = await call('PATCH', `/admin/reports/${report.json.id}`, { ...A, body: { status: 'RESOLVED', resolution: 'smoke checked' } });
  ok(resolved.status === 200 && resolved.json?.status === 'RESOLVED', 'admin resolves the report');
  const reResolve = await call('PATCH', `/admin/reports/${report.json.id}`, { ...A, body: { status: 'DISMISSED', resolution: 'second opinion' } });
  ok(reResolve.status === 409, 'a decided report cannot be overwritten', `status ${reResolve.status}`);
  const jobs = await call('GET', '/admin/jobs', A);
  ok(jobs.status === 200 && typeof jobs.json?.queue?.waiting === 'number', 'jobs overview + queue counts', `${jobs.json?.items?.length} runs`);
  const auditV11 = await call('GET', '/admin/audit?limit=10', A);
  ok(auditV11.json?.items?.some((a) => a.action === 'settings.update'), 'settings changes are audited');
}
// ---------------------------------------------------------------- RevenueCat webhook (store billing)
const benv = Object.fromEntries((await readFile(new URL('../apps/backend/.env', import.meta.url), 'utf8'))
  .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (benv.REVENUECAT_WEBHOOK_SECRET) {
  const rcUser = (await call('GET', '/me', { token: vt })).json;
  const rc = async (event, opts = {}) => {
    const raw = JSON.stringify({ api_version: '1.0', event });
    const t = Math.floor(Date.now() / 1000) - (opts.age ?? 0);
    const v1 = createHmac('sha256', opts.secret ?? benv.REVENUECAT_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
    const res = await fetch(`${API}/webhooks/revenuecat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: benv.REVENUECAT_WEBHOOK_AUTH ?? '', 'x-revenuecat-webhook-signature': `t=${t},v1=${v1}` },
      body: raw,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const waitFor = async (fn) => { for (let i = 0; i < 30; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 300)); } return null; };
  const evId = `smoke_${crypto.randomUUID()}`;
  const purchase = { id: evId, type: 'INITIAL_PURCHASE', app_user_id: rcUser.id, product_id: 'casalume_pro_monthly', entitlement_ids: ['pro'], period_type: 'NORMAL', expiration_at_ms: Date.now() + 30 * 86400_000, environment: 'SANDBOX', store: 'APP_STORE' };
  const forged = await rc(purchase, { secret: 'wrong-secret-0123456789' });
  ok(forged.status === 401, 'forged RevenueCat signature rejected before any write');
  const stale = await rc(purchase, { age: 600 });
  ok(stale.status === 401, 'stale signature timestamp rejected (replay window 5 min)');
  const first = await rc(purchase);
  const dup = await rc(purchase);
  ok(first.status === 200 && first.json?.result === 'queued' && dup.json?.result === 'duplicate', 'webhook stored once; retry acknowledged as duplicate');
  const proNow = await waitFor(async () => { const m = (await call('GET', '/me', { token: vt })).json; return m?.plan === 'PRO' ? m : null; });
  ok(proNow?.plan === 'PRO' && proNow.planExpiresAt, 'INITIAL_PURCHASE → user is PRO until the store expiry');
  const creditsBefore = proNow?.credits ?? 0;
  const pack = { id: `smoke_${crypto.randomUUID()}`, type: 'NON_RENEWING_PURCHASE', app_user_id: rcUser.id, product_id: 'casalume_credits_10', transaction_id: `txn_${Date.now()}`, store: 'PLAY_STORE', environment: 'SANDBOX' };
  await rc(pack);
  await rc({ ...pack, id: `smoke_${crypto.randomUUID()}` }); // same transaction delivered as a different event
  const withCredits = await waitFor(async () => { const m = (await call('GET', '/me', { token: vt })).json; return m?.credits >= creditsBefore + 10 ? m : null; });
  await new Promise((r) => setTimeout(r, 800));
  const afterDup = (await call('GET', '/me', { token: vt })).json;
  ok(withCredits && afterDup.credits === creditsBefore + 10, 'credit pack credited exactly once per store transaction', `${creditsBefore} → ${afterDup.credits}`);
  await rc({ ...purchase, id: `smoke_${crypto.randomUUID()}`, type: 'EXPIRATION', expiration_at_ms: Date.now() - 1000 });
  const expired = await waitFor(async () => { const m = (await call('GET', '/me', { token: vt })).json; return m?.plan === 'FREE' ? m : null; });
  ok(expired?.plan === 'FREE', 'EXPIRATION → back to FREE');
  const orphan = await rc({ id: `smoke_${crypto.randomUUID()}`, type: 'RENEWAL', app_user_id: '$RCAnonymousID:abc', entitlement_ids: ['pro'] });
  if (adminToken) {
    const unmatched = await waitFor(async () => {
      const list = (await call('GET', '/admin/billing/events?status=unmatched', { token: adminToken })).json;
      return list?.items?.length ? list : null;
    });
    ok(orphan.status === 200 && unmatched?.items?.length >= 1, 'event for an unknown app user lands in admin "unmatched" list');
  }
}
// #6 admin roles + MFA recovery (AZ-05, AUT-01, AUT-04). Admin login is limited to 5 / 15 min per IP,
// so this block uses at most two more login calls.
if (adminToken) {
  const meAdmin = await call('GET', '/admin/me', { token: adminToken });
  ok(meAdmin.status === 200 && meAdmin.json?.role === 'SUPER_ADMIN' && meAdmin.json.mfa?.enrolled === true, 'seed admin is SUPER_ADMIN with MFA');
  const selfRole = await call('PATCH', `/admin/admins/${meAdmin.json.id}`, { token: adminToken, body: { role: 'ADMIN', reason: 'smoke self change' } });
  ok(selfRole.status === 400, 'SUPER_ADMIN cannot change own role (AZ-05)');
  const guestPromote = await call('PATCH', `/admin/admins/${other.json.user.id}`, { token: adminToken, body: { role: 'SUPPORT', reason: 'smoke guest promote' } });
  ok(guestPromote.status === 400, 'guest accounts cannot become admins');
  const staffId = newPw.json.user.id;
  const promote = await call('PATCH', `/admin/admins/${staffId}`, { token: adminToken, body: { role: 'SUPPORT', reason: 'smoke support agent' } });
  ok(promote.status === 200 && promote.json?.role === 'SUPPORT' && promote.json.mfa?.enrolled === false && !!promote.json.mfa.enrollBefore, 'verified user promoted to SUPPORT with a 72 h enrollment window');
  const roleMail = await lastMailTo(userEmail, 'rolün değişti');
  ok(!!roleMail, 'promoted admin is notified by e-mail (AUT-04)');

  const pw = 'second-password-456';
  const enroll = await call('POST', '/admin/auth/mfa/enroll', { body: { email: userEmail, password: pw } });
  ok(enroll.status === 201 && /^otpauth:\/\/totp\//.test(enroll.json?.otpauth ?? ''), 'promoted admin starts TOTP enrollment');
  const badConfirm = await call('POST', '/admin/auth/mfa/confirm', { body: { email: userEmail, password: pw, otp: '000000' } });
  const firstCode = totp(enroll.json.secret);
  const confirm = await call('POST', '/admin/auth/mfa/confirm', { body: { email: userEmail, password: pw, otp: firstCode } });
  ok(badConfirm.status === 401 && confirm.status === 201 && confirm.json?.backupCodes?.length === 10 && !!confirm.json.accessToken,
    'enrollment needs a valid first code → session + 10 recovery codes');
  const staffToken = confirm.json?.accessToken;

  const sRead = await call('GET', '/admin/users?limit=1', { token: staffToken });
  const sSettings = await call('PATCH', '/admin/settings', { token: staffToken, body: {} });
  const sAdmins = await call('GET', '/admin/admins', { token: staffToken });
  const sEscalate = await call('PATCH', `/admin/admins/${staffId}`, { token: staffToken, body: { role: 'SUPER_ADMIN', reason: 'self escalation' } });
  ok(sRead.status === 200 && sSettings.status === 403 && sAdmins.status === 403 && sEscalate.status === 403,
    'SUPPORT reads, but cannot change settings, list admins or escalate itself (AZ-01/AZ-05)', `${sRead.status}/${sSettings.status}/${sAdmins.status}/${sEscalate.status}`);

  const recovery = confirm.json.backupCodes[0];
  const bLogin = await call('POST', '/admin/auth/login', { body: { email: userEmail, password: pw, backupCode: recovery.toLowerCase() } });
  const bReuse = await call('POST', '/admin/auth/login', { body: { email: userEmail, password: pw, backupCode: recovery } });
  ok(bLogin.status === 201 && bLogin.json?.backupCodesRemaining === 9 && bReuse.status === 401, 'recovery code signs in once, then is spent (AUT-04)', `${bLogin.status}/${bReuse.status}`);

  const replayStepUp = await call('POST', '/admin/me/backup-codes', { token: bLogin.json?.accessToken, body: { otp: firstCode } });
  const step = Math.floor(Date.now() / 30000);
  while (Math.floor(Date.now() / 30000) === step) await new Promise((r) => setTimeout(r, 250)); // next TOTP window (≤ 30 s)
  const regen = await call('POST', '/admin/me/backup-codes', { token: bLogin.json?.accessToken, body: { otp: totp(enroll.json.secret) } });
  const staffMe = await call('GET', '/admin/me', { token: bLogin.json?.accessToken });
  ok(replayStepUp.status === 403 && replayStepUp.json?.error?.code === 'step_up_failed' && regen.status === 201 && regen.json?.backupCodes?.length === 10 && staffMe.json?.mfa?.backupCodesRemaining === 10,
    'regenerating recovery codes needs a fresh TOTP code (step-up)');

  const mfaReset = await call('POST', `/admin/admins/${staffId}/mfa-reset`, { token: adminToken, body: { reason: 'smoke lost phone' } });
  const afterReset = await call('GET', '/admin/me', { token: bLogin.json?.accessToken });
  ok(mfaReset.status === 201 && mfaReset.json?.mfa?.enrolled === false && afterReset.status === 401, 'SUPER_ADMIN MFA reset ends the admin\'s sessions');
  const demote = await call('PATCH', `/admin/admins/${staffId}`, { token: adminToken, body: { role: 'USER', reason: 'smoke cleanup' } });
  ok(demote.status === 200 && demote.json?.role === 'USER', 'admin role removed (back to USER)');
  const roleAudit = await call('GET', '/admin/audit?limit=30', { token: adminToken });
  const actions = new Set((roleAudit.json?.items ?? []).map((a) => a.action));
  ok(['admin.role_change', 'admin.mfa_reset', 'admin.mfa_enrolled'].every((a) => actions.has(a)), 'role and MFA changes are audited (LOG-01)');
}

const docs = await fetch(API.replace(/\/v1$/, '') + '/docs/openapi.json');
const spec = docs.ok ? await docs.json() : null;
ok(spec && Object.keys(spec.paths).length >= 40, 'Swagger/OpenAPI document served in development', spec ? `${Object.keys(spec.paths).length} paths` : `status ${docs.status}`);
const mustHave = ['/v1/admin/jobs', '/v1/admin/billing/events', '/v1/webhooks/revenuecat', '/v1/billing/sync', '/v1/designs', '/v1/me/push-tokens', '/v1/admin/me', '/v1/admin/admins', '/v1/auth/oauth/nonce', '/v1/auth/oauth/google', '/v1/auth/oauth/apple', '/v1/webhooks/apple', '/v1/me/identities', '/v1/me/identities/{provider}', '/v1/app/version', '/v1/legal', '/v1/legal/{kind}', '/v1/me/data-requests', '/v1/admin/legal', '/v1/admin/legal/{id}', '/v1/admin/legal/publish', '/v1/admin/data-requests', '/v1/admin/data-requests/{id}'];
ok(spec && mustHave.every((p) => spec.paths[p]), 'every expected route is registered once (no decorator collisions)', mustHave.filter((p) => !spec?.paths?.[p]).join(', ') || 'all present');

const del = await call('DELETE', `/designs/${design.json.id}`, { token });
ok(del.status === 204, 'user deletes own design');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
