// Demo data for the admin panel and screenshots: users, designs with images, reports, KVKK applications, store
// events with prices, subscriptions, support tickets, broadcasts, marketing drafts, draft blog posts, firms with
// projects, AI costs, spread over the last 60 days.
//
// Every demo row is marked and removed by the next run (or by --clear): users @demo.casalume.invalid (and the old
// @demo.airoom.local), guest devices "demo:*", store events "demo-*", firms noted "[demo]", broadcasts titled
// "[Demo] …", marketing drafts with input.demo, blog posts slugged "demo-…". Real data is never touched.
//
// Usage:  npm run db:seed:demo            (development)
//         npm run db:seed:demo -- --clear (remove the demo rows only)
//         DEMO_IN_PRODUCTION=yes npm run db:seed:demo   (production, the owner's explicit choice before launch)
// In production no staff accounts, audit entries or legal drafts are created (the audit trail stays genuine), no
// e-mail or push is sent, nothing is scheduled, and blog posts stay drafts (never on the public site).
import 'dotenv/config';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';
import { loadConfig } from '../src/config.js';
import { ROOMS, STYLE_SEED, TOOL_IDS } from '../src/catalog/catalog.data.js';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { createObjectStore } from '../src/images/object-store.js';
import { SAMPLE_IDS, loadSample, type SampleId } from '../src/images/samples.js';
import { INITIAL_LEGAL_VERSION } from '../src/kvkk/legal.js';
import { AsoListingSchema, blogArticleSchema, campaignSchema, seoSchema, socialPostSchema } from '../src/marketing/marketing.rules.js';
import { weeklyMetrics } from '../src/marketing/weekly-report.js';

const cfg = loadConfig();
const PRODUCTION = cfg.NODE_ENV === 'production';
const CLEAR_ONLY = process.argv.includes('--clear');
if (PRODUCTION && !CLEAR_ONLY && process.env.DEMO_IN_PRODUCTION !== 'yes') {
  console.error('seed-demo: production needs DEMO_IN_PRODUCTION=yes (the owner\'s explicit choice). Nothing was changed.');
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: cfg.DATABASE_URL }) });
const store = createObjectStore(cfg, path.resolve(cfg.DATA_DIR, 'images'));

const DOMAIN = 'demo.casalume.invalid'; // .invalid never resolves: no mail can reach these addresses
const OLD_DOMAINS = ['demo.airoom.local'];
const DAY = 86_400_000;
const now = Date.now();

// Deterministic, so every run produces the same picture.
let state = 20261103;
const rnd = () => ((state = (state * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const daysAgo = (d: number, hour = int(8, 23)) => new Date(now - d * DAY - (24 - hour) * 3_600_000 - int(0, 59) * 60_000);

const PEOPLE = [
  'Ayşe Yılmaz', 'Mehmet Kaya', 'Zeynep Demir', 'Emre Şahin', 'Elif Çelik', 'Burak Aydın', 'Selin Öztürk', 'Can Arslan',
  'Deniz Koç', 'Ece Kurt', 'Mert Özdemir', 'İrem Polat', 'Kerem Aksoy', 'Gizem Erdoğan', 'Onur Yıldız', 'Buse Tekin',
  'Hakan Çetin', 'Derya Uçar', 'Serkan Bulut', 'Nazlı Güneş', 'Tolga Karaca', 'Pınar Avcı', 'Ozan Doğan', 'Melis Ateş',
];
const slug = (name: string) =>
  name.toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/\s+/g, '.');

const SAMPLE_FOR_TOOL: Record<string, SampleId[]> = {
  exterior: ['exterior'], garden: ['garden'], furnish: ['empty_room'], declutter: ['living_room', 'bedroom'],
};
const ROOM_FOR_SAMPLE: Record<SampleId, string> = { living_room: 'living_room', empty_room: 'salon', bedroom: 'bedroom', exterior: 'living_room', garden: 'balcony' };

async function resetDemo() {
  const users = await prisma.user.findMany({
    where: { OR: [...[DOMAIN, ...OLD_DOMAINS].map((d) => ({ email: { endsWith: `@${d}` } })), { deviceHash: { startsWith: 'demo:' } }] },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const images = await prisma.image.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
  await store.delete(images.map((i) => `${i.id}.jpg`));
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.aiUsage.deleteMany({ where: { userId: { in: ids } } });
  await prisma.dataRequest.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { reference: { contains: '-DEMO' } }, ...[DOMAIN, ...OLD_DOMAINS].map((d) => ({ contactEmail: { endsWith: `@${d}` } }))] },
  });
  await prisma.legalDocument.deleteMany({ where: { createdBy: { in: ids }, publishedAt: null } });
  await prisma.webhookEvent.deleteMany({ where: { id: { startsWith: 'demo-' } } });
  await prisma.broadcast.deleteMany({ where: { title: { startsWith: '[Demo] ' } } });
  await prisma.marketingDraft.deleteMany({ where: { input: { path: ['demo'], equals: true } } });
  await prisma.blogPost.deleteMany({ where: { slug: { startsWith: 'demo-' } } });
  // Designs, images, reports, ledger, consents, tickets, subscriptions, memberships cascade with the users; the
  // firms go after them (their designs are gone by then).
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.organization.deleteMany({ where: { note: '[demo]' } });
  return { users: ids.length, images: images.length };
}

/** "After" image: the sample photo washed in the style's palette, so each result looks different. */
async function styledVariant(sample: Buffer, palette: string[]) {
  const [w, h] = [1024, 768];
  const base = await sharp(sample).resize(w, h, { fit: 'cover' }).modulate({ saturation: 0.85, brightness: 1.04 }).toBuffer();
  // An SVG gradient is a cheap soft wash (a full-size blur is CPU-heavy).
  const colors = palette.slice(0, 3);
  const stops = colors.map((hex, i) => `<stop offset="${i / Math.max(1, colors.length - 1)}" stop-color="${hex}"/>`).join('');
  const wash = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  return sharp(base).composite([{ input: wash, blend: 'soft-light' }]).jpeg({ quality: 80 }).toBuffer();
}

async function saveImage(buffer: Buffer, ownerId: string, kind: 'UPLOAD' | 'SAMPLE' | 'RESULT', createdAt: Date, designId?: string) {
  const id = randomUUID();
  const { width = 1024, height = 768 } = await sharp(buffer).metadata();
  await store.put(`${id}.jpg`, buffer, 'image/jpeg');
  await prisma.image.create({ data: { id, ownerId, kind, width, height, bytes: buffer.length, createdAt, ...(designId ? { designId } : {}) } });
  return id;
}

async function main() {
  const removed = await resetDemo();
  const consentVersion = INITIAL_LEGAL_VERSION;
  const samples = Object.fromEntries(
    await Promise.all(SAMPLE_IDS.map(async (id) => [id, await sharp(await loadSample(id)).resize(1024, 768, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()] as const)),
  ) as Record<SampleId, Buffer>;

  // Staff: two demo admins without a password (they cannot sign in), so the team and audit screens have people.
  const staff = PRODUCTION ? [] : await Promise.all([
    prisma.user.create({ data: { email: `destek@${DOMAIN}`, name: 'Derya Destek', role: 'SUPPORT', isGuest: false, emailVerifiedAt: daysAgo(40), createdAt: daysAgo(45), lastSeenAt: daysAgo(0) } }),
    prisma.user.create({ data: { email: `editor@${DOMAIN}`, name: 'Ege Editör', role: 'EDITOR', isGuest: false, emailVerifiedAt: daysAgo(30), createdAt: daysAgo(32), lastSeenAt: daysAgo(2) } }),
  ]);

  // Customers: registered (some PRO, one banned) and guests.
  const customers: { id: string; name: string | null; email: string | null; createdAt: Date; pro: boolean }[] = [];
  for (const [i, name] of PEOPLE.entries()) {
    const createdAt = daysAgo(int(1, 58));
    const pro = i % 5 === 1;
    const u = await prisma.user.create({
      data: {
        email: `${slug(name)}@${DOMAIN}`, name, isGuest: false, emailVerifiedAt: i % 7 === 3 ? null : createdAt, createdAt,
        lastSeenAt: new Date(Math.min(now, createdAt.getTime() + int(0, 40) * DAY)),
        plan: pro ? 'PRO' : 'FREE', planExpiresAt: pro ? new Date(now + int(5, 300) * DAY) : null, storeProUntil: pro ? new Date(now + int(5, 300) * DAY) : null,
        credits: i % 4 === 0 ? int(1, 25) : 0, status: i === 11 ? 'BANNED' : 'ACTIVE', locale: i % 6 === 5 ? 'en' : 'tr',
      },
    });
    customers.push({ id: u.id, name, email: u.email, createdAt, pro });
    if (pro) {
      await prisma.subscription.create({
        data: { userId: u.id, entitlement: 'pro', productId: pick(['pro_monthly', 'pro_yearly']), store: pick(['APP_STORE', 'PLAY_STORE']), environment: 'PRODUCTION', periodType: 'NORMAL', status: i === 6 ? 'cancelled' : i === 16 ? 'grace' : 'active', expiresAt: u.planExpiresAt, ...(i === 16 ? { gracePeriodExpiresAt: new Date(now + 3 * DAY) } : {}) },
      });
    } else if (i % 5 === 3) {
      // Trials, a billing problem and lapsed subscribers, so every status tab has rows.
      const kind = [['active', 'TRIAL', 5], ['billing_issue', 'NORMAL', 2], ['expired', 'NORMAL', -12], ['expired', 'TRIAL', -20], ['active', 'TRIAL', 2]][Math.floor(i / 5) % 5] as [string, string, number];
      await prisma.subscription.create({
        data: { userId: u.id, entitlement: 'pro', productId: 'pro_monthly', store: pick(['APP_STORE', 'PLAY_STORE']), environment: 'PRODUCTION', periodType: kind[1], status: kind[0], expiresAt: new Date(now + kind[2] * DAY) },
      });
    }
    await prisma.consent.createMany({
      data: (['terms', 'privacy', 'ai_processing'] as const).map((kind) => ({ userId: u.id, kind, version: consentVersion, granted: true, ip: null, createdAt })),
    });
    if (u.credits) await prisma.creditLedger.create({ data: { userId: u.id, delta: u.credits + int(0, 10), reason: 'purchase:casalume_credits_10', refId: `demo-pack-${i}`, createdAt } });
    if (i % 3 === 0 && u.emailVerifiedAt) await prisma.creditLedger.create({ data: { userId: u.id, delta: 3, reason: 'welcome', createdAt } });
  }
  for (let i = 0; i < 16; i++) {
    const createdAt = daysAgo(int(0, 30));
    const u = await prisma.user.create({ data: { deviceHash: `demo:${i}:${randomUUID()}`, isGuest: true, createdAt, lastSeenAt: createdAt } });
    customers.push({ id: u.id, name: null, email: null, createdAt, pro: false });
  }

  // Designs with input and result images; most succeed, some fail, a few are still running.
  const designs: { id: string; userId: string; createdAt: Date; status: string }[] = [];
  const active = customers.filter((c, i) => i !== 11);
  for (let n = 0; n < 46; n++) {
    const owner = pick(active);
    const age = Math.min(int(0, 29), Math.floor((now - owner.createdAt.getTime()) / DAY));
    const createdAt = daysAgo(Math.max(0, age));
    const tool = pick(TOOL_IDS.filter((t) => t !== 'custom'));
    const sampleId = pick(SAMPLE_FOR_TOOL[tool] ?? ['living_room', 'empty_room', 'bedroom']);
    const style = pick(STYLE_SEED);
    const status = n % 11 === 4 ? 'FAILED' : n === 0 || n === 1 ? 'PENDING' : 'SUCCEEDED';
    const id = randomUUID();
    const inputImageId = await saveImage(samples[sampleId], owner.id, n % 3 === 0 ? 'SAMPLE' : 'UPLOAD', createdAt);
    await prisma.design.create({
      data: {
        id, userId: owner.id, tool, styleId: ['redesign', 'furnish', 'exterior', 'garden'].includes(tool) ? style.id : null,
        roomId: ROOM_FOR_SAMPLE[sampleId] in ROOMS ? ROOM_FOR_SAMPLE[sampleId] : null, params: { variants: status === 'SUCCEEDED' && n % 4 === 0 ? 2 : 1 },
        provider: 'gemini', status, error: status === 'FAILED' ? pick(['provider_timeout', 'safety_blocked', 'no_change']) : null,
        inputImageId, creditsUsed: owner.pro || n % 6 ? 0 : 1, freeUsed: owner.pro ? 0 : 1, chargeDay: createdAt.toISOString().slice(0, 10),
        chargeState: status === 'FAILED' ? 'RELEASED' : status === 'PENDING' ? 'HELD' : 'CAPTURED',
        queuedAt: createdAt, startedAt: createdAt, favorite: n % 5 === 0, featured: status === 'SUCCEEDED' && n % 8 === 2,
        createdAt, finishedAt: status === 'PENDING' ? null : new Date(createdAt.getTime() + int(9, 40) * 1000),
      },
    });
    if (status === 'SUCCEEDED') {
      const variants = n % 4 === 0 ? 2 : 1;
      for (let v = 0; v < variants; v++) {
        await saveImage(await styledVariant(samples[sampleId], v ? [...style.palette].reverse() : style.palette), owner.id, 'RESULT', createdAt, id);
      }
      await prisma.aiUsage.create({
        data: { kind: 'generate', provider: 'gemini', model: 'gemini-2.5-flash-image', images: variants, costUsd: 0.039 * variants, latencyMs: int(8000, 30000), userId: owner.id, designId: id, createdAt },
      });
      if (n % 3 === 0) {
        await prisma.aiUsage.create({
          data: { kind: 'analyze', provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: int(1800, 2600), outputTokens: int(700, 1200), costUsd: 0.03, latencyMs: int(4000, 9000), userId: owner.id, designId: id, createdAt },
        });
      }
    } else if (status === 'FAILED') {
      await prisma.aiUsage.create({ data: { kind: 'generate', provider: 'gemini', model: 'gemini-2.5-flash-image', costUsd: 0, latencyMs: 150_000, fallbackUsed: true, userId: owner.id, designId: id, createdAt } });
    }
    designs.push({ id, userId: owner.id, createdAt, status });
  }
  for (let d = 0; d < 30; d++) {
    await prisma.aiUsage.createMany({
      data: Array.from({ length: int(1, 4) }, () => ({ kind: 'chat', provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: int(600, 1500), outputTokens: int(150, 400), costUsd: 0.008, latencyMs: int(1500, 4000), userId: pick(active).id, createdAt: daysAgo(d) })),
    });
  }

  // Content reports on generated designs: open, resolved and dismissed.
  const done = designs.filter((d) => d.status === 'SUCCEEDED');
  const reports: Prisma.ContentReportCreateManyInput[] = [
    ['inappropriate', 'Görselde uygunsuz bir figür var', 'OPEN'],
    ['privacy', 'Komşumun evi görünüyor', 'OPEN'],
    ['offensive', null, 'OPEN'],
    ['copyright', 'Bu tasarım bir mağazanın kataloğundan kopya', 'RESOLVED'],
    ['other', 'Oda tanınmayacak hale gelmiş', 'DISMISSED'],
    ['inappropriate', null, 'RESOLVED'],
  ].map(([reason, note, status], i) => {
    const target = done[(i * 5) % done.length]!;
    const createdAt = new Date(Math.min(now - 3_600_000, target.createdAt.getTime() + int(1, 48) * 3_600_000));
    return {
      designId: target.id, reporterId: pick(active).id, reason: reason!, note, status: status as 'OPEN' | 'RESOLVED' | 'DISMISSED', createdAt,
      ...(status !== 'OPEN' ? { resolution: status === 'RESOLVED' ? 'Tasarım öne çıkanlardan kaldırıldı' : 'Politikaya aykırı bir şey bulunmadı', resolvedBy: staff[0]?.id ?? null, resolvedAt: new Date(createdAt.getTime() + DAY) } : {}),
    };
  });
  await prisma.contentReport.createMany({ data: reports });

  // KVKK m.11 applications: overdue, due soon, fresh, answered and rejected.
  const kvkk: [number, string, string, 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED', string | null][] = [
    [33, 'erasure', 'app', 'RECEIVED', null],
    [26, 'access', 'email', 'IN_PROGRESS', null],
    [24, 'rectification', 'app', 'RECEIVED', null],
    [4, 'info', 'app', 'RECEIVED', null],
    [1, 'objection', 'kep', 'RECEIVED', null],
    [20, 'access', 'app', 'COMPLETED', 'Hesabına ait bütün verilerin bir kopyası e-posta adresine gönderildi.'],
    [15, 'compensation', 'letter', 'REJECTED', 'Başvuruda belirtilen zarar ile hizmetimiz arasında bir bağ bulunamadı; ayrıntılar yanıt yazımızda.'],
  ];
  for (const [i, [ago, type, channel, status, response]] of kvkk.entries()) {
    const receivedAt = daysAgo(ago, 10);
    const applicant = channel === 'app' ? customers[i * 3]! : null;
    await prisma.dataRequest.create({
      data: {
        reference: `KVKK-${receivedAt.getUTCFullYear()}-DEMO${String.fromCharCode(65 + i)}${i + 2}`, userId: applicant?.id ?? null, type, channel,
        contactEmail: applicant ? null : `basvuru${i}@${DOMAIN}`, receivedAt, dueAt: new Date(receivedAt.getTime() + 30 * DAY),
        details: {
          erasure: 'Hesabımın ve yüklediğim bütün fotoğrafların silinmesini istiyorum.',
          access: 'Hakkımda hangi kişisel verilerin işlendiğini ve kimlerle paylaşıldığını öğrenmek istiyorum.',
          rectification: 'Profilimdeki ad bilgisi yanlış görünüyor, düzeltilmesini rica ederim.',
          info: 'Fotoğraflarımın yapay zekâ modelini eğitmek için kullanılıp kullanılmadığını öğrenmek istiyorum.',
          objection: 'Pazarlama amaçlı otomatik profillemeye itiraz ediyorum.',
          compensation: 'Uygulamadaki bir hata nedeniyle uğradığım zararın giderilmesini talep ediyorum.',
        }[type]!,
        status, response, handledBy: status === 'RECEIVED' ? null : (staff[0]?.id ?? null), closedAt: response ? new Date(receivedAt.getTime() + 6 * DAY) : null, createdAt: receivedAt,
      },
    });
  }

  // RevenueCat inbox with real-looking amounts (USD price + local TRY, store share and tax), so the revenue
  // analytics have something to show: first purchases, renewals, trials, credit packs, one refund, one failure and
  // one unmatched event.
  const PRICES: Record<string, { usd: number; try: number; days: number }> = {
    pro_monthly: { usd: 4.99, try: 179.99, days: 30 }, pro_yearly: { usd: 39.99, try: 1399.99, days: 365 }, casalume_credits_10: { usd: 1.99, try: 69.99, days: 0 },
  };
  const paid = (id: string, type: string, userId: string | null, product: string, at: Date, extra: Record<string, unknown> = {}): Prisma.WebhookEventCreateManyInput => {
    const p = PRICES[product]!;
    const ms = at.getTime();
    return {
      id, source: 'revenuecat', type, appUserId: userId ?? '$RCAnonymousID:demo', userId, status: userId ? 'processed' : 'unmatched', receivedAt: at, processedAt: userId ? at : null,
      payload: {
        id, type, product_id: product, store: pick(['APP_STORE', 'PLAY_STORE']), environment: 'PRODUCTION', period_type: 'NORMAL',
        price: p.usd, price_in_purchased_currency: p.try, currency: 'TRY', commission_percentage: 0.15, tax_percentage: 0.18,
        event_timestamp_ms: ms, purchased_at_ms: ms, ...(p.days ? { expiration_at_ms: ms + p.days * DAY } : { transaction_id: `${id}-txn` }), ...extra,
      },
    };
  };
  const proUsers = customers.filter((c) => c.pro);
  const events: Prisma.WebhookEventCreateManyInput[] = [];
  for (const [i, u] of proUsers.entries()) {
    const product = i % 3 === 2 ? 'pro_yearly' : 'pro_monthly';
    events.push(paid(`demo-${i}-initial`, 'INITIAL_PURCHASE', u.id, product, daysAgo(int(20, 55))));
    if (product === 'pro_monthly') events.push(paid(`demo-${i}-renewal`, 'RENEWAL', u.id, product, daysAgo(int(0, 15))));
  }
  for (let i = 0; i < 4; i++) {
    const u = customers[i * 4]!;
    events.push(paid(`demo-trial-${i}`, 'INITIAL_PURCHASE', u.id, 'pro_monthly', daysAgo(int(1, 25)), { period_type: 'TRIAL', price: 0, price_in_purchased_currency: 0 }));
  }
  for (let i = 0; i < 9; i++) events.push(paid(`demo-pack-${i}`, 'NON_RENEWING_PURCHASE', customers[(i * 3) % 20]!.id, 'casalume_credits_10', daysAgo(int(0, 29))));
  events.push(
    paid('demo-refund-1', 'CANCELLATION', proUsers[0]!.id, 'pro_monthly', daysAgo(4), { cancel_reason: 'CUSTOMER_SUPPORT', price: -4.99, price_in_purchased_currency: -179.99 }),
    paid('demo-cancel-1', 'CANCELLATION', proUsers[1]!.id, 'pro_monthly', daysAgo(6), { cancel_reason: 'UNSUBSCRIBE' }),
    { ...paid('demo-failed-1', 'NON_RENEWING_PURCHASE', customers[0]!.id, 'casalume_credits_10', daysAgo(0)), status: 'failed', processedAt: null, error: 'subscriber_sync_timeout' },
    paid('demo-unmatched-1', 'INITIAL_PURCHASE', null, 'pro_monthly', daysAgo(3)),
  );
  await prisma.webhookEvent.createMany({ data: events });

  // A draft legal text and a few audit entries by the demo staff (development only: production keeps a genuine trail).
  if (!PRODUCTION) {
  await prisma.legalDocument.create({
    data: { kind: 'marketing', version: '2026-12-01', locale: 'tr', title: 'Ticari Elektronik İleti Onayı (taslak)', body: 'Bu metin demo amaçlı bir taslaktır. Kampanya ve yeniliklerden e-posta ve bildirim yoluyla haberdar olmak için onay verirsin; onayını istediğin an geri çekebilirsin.', requiresConsent: true, createdBy: staff[1]!.id },
  });
  await prisma.auditLog.createMany({
    data: [
      { actorId: staff[0]!.id, action: 'report.resolve', targetType: 'report', targetId: null, meta: { status: 'RESOLVED' }, createdAt: daysAgo(3) },
      { actorId: staff[1]!.id, action: 'design.feature', targetType: 'design', targetId: done[2]!.id, meta: { featured: true }, createdAt: daysAgo(5) },
      { actorId: staff[1]!.id, action: 'style.update', targetType: 'style', targetId: 'japandi', meta: { fields: ['descriptionTr'] }, createdAt: daysAgo(8) },
      { actorId: staff[0]!.id, action: 'kvkk.request_update', targetType: 'data_request', targetId: null, meta: { status: 'IN_PROGRESS' }, createdAt: daysAgo(2) },
      { actorId: staff[1]!.id, action: 'legal.draft_create', targetType: 'legal', targetId: null, meta: { kind: 'marketing', version: '2026-12-01', locale: 'tr' }, createdAt: daysAgo(1) },
    ],
  });
  }

  const extra = await seedNewerScreens(customers, designs, done);

  console.log(
    `demo: removed ${removed.users} users / ${removed.images} images; created ${staff.length} staff, ${customers.length} customers, ` +
      `${designs.length} designs, ${reports.length} reports, ${kvkk.length} KVKK applications, ${events.length} store events, ` +
      `${extra.tickets} support tickets, ${extra.broadcasts} broadcasts, ${extra.drafts} marketing drafts, ${extra.posts} draft blog posts, ${extra.orgs} firms` +
      (PRODUCTION ? ' (production: no staff, audit or legal drafts)' : ''),
  );
}


type Customer = { id: string; name: string | null; email: string | null; createdAt: Date; pro: boolean };
type DemoDesign = { id: string; userId: string; createdAt: Date; status: string };

/** Screens added after the first demo: support, broadcasts, marketing, blog drafts and firms. */
async function seedNewerScreens(customers: Customer[], designs: DemoDesign[], done: DemoDesign[]) {
  const registered = customers.filter((c) => c.email);

  // Support tickets: waiting, answered and closed conversations (staff replies carry no staff id here).
  const TICKETS: Array<[string, string, string, 'OPEN' | 'ANSWERED' | 'CLOSED', string[]]> = [
    ['bug', 'Tasarım yarıda kaldı', 'Stüdyoda Japandi stilini seçtim, yükleme çubuğu dolmadan durdu. Hakkım düştü mü?', 'OPEN', []],
    ['billing', 'PRO aldım ama görünmüyor', 'Dün App Store üzerinden aylık PRO aldım, uygulamada hâlâ ücretsiz görünüyorum.', 'ANSWERED', ['Merhaba, satın alman bize ulaştı ve hesabın PRO olarak güncellendi. Uygulamayı yeniden açman yeterli.']],
    ['design', 'Bahçe aracı ağaçları siliyor', 'Bahçe & Teras aracında mevcut zeytin ağaçlarım kayboldu. Korunmasını sağlayabilir miyim?', 'OPEN', []],
    ['account', 'E-posta adresimi değiştirmek istiyorum', 'Kayıt olurken eski iş adresimi kullandım, kişisel adresime geçirmek istiyorum.', 'CLOSED', ['Merhaba, adresin güncellendi; doğrulama e-postasını yeni adresine gönderdik. İyi tasarımlar!']],
    ['idea', 'Ölçü girerek tasarım', 'Odamın ölçülerini girip mobilyaların sığıp sığmadığını görebilsem harika olurdu.', 'ANSWERED', ['Harika fikir, teşekkürler! Yol haritamıza ekledik.']],
    ['other', 'Faturamı nereden alırım?', 'Kredi paketi aldım, şirketim için fatura gerekiyor.', 'OPEN', []],
  ];
  for (const [i, [category, subject, body, status, replies]] of TICKETS.entries()) {
    const owner = registered[(i * 4 + 1) % registered.length]!;
    const created = daysAgo(int(1, 20));
    const msgs: Array<{ author: string; body: string; createdAt: Date }> = [{ author: 'USER', body, createdAt: created }];
    replies.forEach((r, k) => msgs.push({ author: 'STAFF', body: r, createdAt: new Date(created.getTime() + (k + 1) * 5 * 3_600_000) }));
    if (status === 'CLOSED') msgs.push({ author: 'USER', body: 'Teşekkürler, sorun çözüldü.', createdAt: new Date(created.getTime() + 30 * 3_600_000) });
    await prisma.supportTicket.create({
      data: {
        reference: `DST-${created.getUTCFullYear()}-DEMO${String(i + 1).padStart(2, '0')}`, userId: owner.id, category, subject, status,
        platform: pick(['web', 'ios', 'android']), locale: 'tr', userUnread: status === 'ANSWERED', lastMessageAt: msgs.at(-1)!.createdAt,
        closedAt: status === 'CLOSED' ? msgs.at(-1)!.createdAt : null, createdAt: created,
        messages: { create: msgs },
      },
    });
  }

  // Broadcasts: two already sent (with delivery reports) and a draft. Nothing is scheduled, so nothing is sent.
  const audienceAll = { accounts: 'all' };
  const sentPush = await prisma.broadcast.create({
    data: {
      title: '[Demo] Yeni: Kapadokya Taş Ev stili', body: 'Doğal taş, kemerler ve sıcak tonlar artık stüdyoda. Odanı birkaç saniyede dönüştür.', link: '/studio',
      kind: 'SERVICE', channel: 'PUSH', audience: audienceAll, status: 'SENT', startedAt: daysAgo(9), finishedAt: daysAgo(9), createdAt: daysAgo(10),
    },
  });
  const sentMail = await prisma.broadcast.create({
    data: {
      title: '[Demo] Hafta sonuna özel: 10 kredilik paket', body: 'Bu hafta sonu stüdyoda daha çok deneme yapmak için kredi paketine göz at. İstediğin zaman abonelikten çıkabilirsin.', link: '/fiyatlar',
      kind: 'MARKETING', channel: 'EMAIL', audience: { accounts: 'registered' }, status: 'SENT', startedAt: daysAgo(3), finishedAt: daysAgo(3), createdAt: daysAgo(4),
    },
  });
  await prisma.broadcast.create({
    data: {
      title: '[Demo] Yılbaşı salon fikirleri', body: 'Salonunu yeni yıla hazırlamak için üç stil önerimiz var.', link: '/blog', kind: 'MARKETING', channel: 'PUSH',
      audience: audienceAll, status: 'DRAFT', createdAt: daysAgo(1),
    },
  });
  const counts = { push: { sent: 0, skipped: 0, opened: 0 }, mail: { sent: 0, skipped: 0, opened: 0 } };
  for (const [k, c] of customers.slice(0, 30).entries()) {
    const pushSent = k % 4 !== 3;
    const pushOpened = pushSent && k % 3 === 0;
    await prisma.broadcastDelivery.create({
      data: { broadcastId: sentPush.id, userId: c.id, status: pushSent ? 'SENT' : 'SKIPPED', reason: pushSent ? null : 'no_device', devices: pushSent ? 1 : 0, sentAt: pushSent ? daysAgo(9) : null, openedAt: pushOpened ? daysAgo(9) : null },
    });
    counts.push.sent += pushSent ? 1 : 0;
    counts.push.skipped += pushSent ? 0 : 1;
    counts.push.opened += pushOpened ? 1 : 0;
    if (!c.email) continue;
    const mailSent = k % 5 !== 2;
    await prisma.broadcastDelivery.create({
      data: { broadcastId: sentMail.id, userId: c.id, status: mailSent ? 'SENT' : 'SKIPPED', reason: mailSent ? null : 'consent_missing', sentAt: mailSent ? daysAgo(3) : null, openedAt: mailSent && k % 4 === 0 ? daysAgo(2) : null },
    });
    counts.mail.sent += mailSent ? 1 : 0;
    counts.mail.skipped += mailSent ? 0 : 1;
    counts.mail.opened += mailSent && k % 4 === 0 ? 1 : 0;
  }
  for (const [b, n] of [[sentPush, counts.push], [sentMail, counts.mail]] as const) {
    await prisma.broadcast.update({ where: { id: b.id }, data: { targetCount: n.sent + n.skipped, sentCount: n.sent, skippedCount: n.skipped, openedCount: n.opened } });
  }

  // Marketing drafts, one per agent, each output checked against the same schema the admin uses.
  const ready = { status: 'READY' as const, costUsd: 0.02, createdAt: daysAgo(2) };
  const drafts: Prisma.MarketingDraftCreateManyInput[] = [
    {
      kind: 'aso', locale: 'tr', ...ready, input: { demo: true, brief: 'Nesne seçip değiştirme özelliğini öne çıkar.', whatsNew: null },
      output: AsoListingSchema.parse({
        app_name: 'Casalume: Yapay Zekâ İç Mimar', app_subtitle: 'Odanı saniyede yeniden tasarla', app_keywords: 'ev,dekorasyon,iç mimar,oda,tasarım,mobilya,boya,bahçe,cephe',
        app_promo: 'Bir fotoğraf yükle, stil seç; Casalume odanı yeniden döşesin. Tek bir koltuğu ya da yastığı seçip yalnız onu değiştir.',
        app_description: 'Casalume ile odanın fotoğrafını çek, 15+ stil arasından seç ve saniyeler içinde yeni hâlini gör. Duvar rengini, zemini ya da tek bir mobilyayı değiştir; alışveriş listesi ve TL bütçe tahmini al.',
        app_whats_new: 'Tek dokunuşla nesne seçme ve yalnız onu değiştirme geldi.', play_title: 'Casalume: AI İç Mimar', play_short: 'Odanı, cepheni ve bahçeni yapay zekâ ile saniyeler içinde yeniden tasarla.',
        play_description: 'Fotoğraf yükle, stil seç, yeni tasarımını gör. Türk ve Anadolu stilleri, alışveriş listesi ve TL bütçe tahmini bir arada.',
      }),
    },
    {
      kind: 'social', locale: 'tr', ...ready, input: { demo: true, styleId: 'japandi', platform: 'instagram', brief: null },
      output: socialPostSchema('instagram').parse({
        title: 'Japandi ile sakin bir salon', caption: 'Doğal ahşap, keten ve az eşya: Japandi salonun tüm huzuru. Kendi odanı Casalume ile dene, sonucu birkaç saniyede gör.',
        hashtags: ['japandi', 'evdekorasyonu', 'icmimari', 'salon', 'casalume'], alt_text: 'Açık ahşap mobilyalar ve bej tonlarıyla Japandi stilinde bir oturma odası.',
      }),
    },
    {
      kind: 'campaign', locale: 'tr', status: 'APPROVED', costUsd: 0.01, createdAt: daysAgo(5), approvedAt: daysAgo(4),
      input: { demo: true, channel: 'PUSH', kind: 'SERVICE', goal: 'Yeni Kapadokya stilini duyur.' },
      output: campaignSchema('PUSH', ['/studio', '/fiyatlar', '/sohbet', '/blog']).parse({ title: 'Kapadokya Taş Ev stili geldi', body: 'Doğal taş ve kemerlerle odanı dönüştür; stüdyoda dene.', link: '/studio' }),
    },
    {
      kind: 'blog', locale: 'tr', ...ready, input: { demo: true, mode: 'write', topic: 'Küçük salonlar için renk seçimi', keywords: 'küçük salon, renk', styleId: 'iskandinav' },
      output: blogArticleSchema.parse({
        title: 'Küçük salonlarda ferahlık veren 5 renk', description: 'Küçük bir salonu daha geniş gösteren renkler, açık tonların ışıkla birlikte nasıl çalıştığı ve doğru vurgu rengini seçmenin püf noktaları.',
        slug: 'kucuk-salon-renk-secimi',
        body: '## Açık tonlar ışığı çoğaltır\n\nKırık beyaz ve kum beji duvarlar gün ışığını yansıtarak odayı daha geniş gösterir. Tavanı duvardan bir ton açık seçmek yüksekliği artırır.\n\n## Tek bir vurgu yeter\n\nAdaçayı yeşili ya da Ege mavisi gibi tek bir vurgu rengi, küçük salonda karmaşa yaratmadan karakter katar. Kendi salonunu [stüdyoda](/studio) farklı renklerle dene.',
      }),
    },
    {
      kind: 'seo', locale: 'tr', ...ready, input: { demo: true },
      output: seoSchema.parse({
        pages: [
          { key: 'home', title: 'Casalume – Yapay zekâ ile oda tasarımı', description: 'Odanın fotoğrafını yükle, stil seç; Casalume odanı, cepheni ve bahçeni saniyeler içinde yeniden tasarlasın.' },
          { key: 'studio', title: 'Tasarım stüdyosu – Casalume', description: 'Fotoğraf yükle, araç ve stil seç, tek bir nesneyi seçip yalnız onu değiştir. Sonuç birkaç saniyede hazır.' },
        ],
      }),
    },
    {
      kind: 'report', locale: 'tr', ...ready, input: { demo: true, send: false },
      output: {
        metrics: JSON.parse(JSON.stringify(await weeklyMetrics(prisma as never))),
        text: {
          summary: 'Bu hafta tasarım sayısı ve yeni kayıtlar arttı; hatalı tasarım oranı düşük kaldı.',
          highlights: ['Japandi ve Modern Türk en çok seçilen stiller.', 'Kredi paketi satışları geçen haftanın üzerinde.'],
          actions: ['Bahçe aracındaki geri bildirimleri incele.', 'Yeni stil duyurusunu e-posta ile de gönder.'],
        },
      },
    },
  ];
  await prisma.marketingDraft.createMany({ data: drafts });

  // Blog: drafts only — a published demo post would appear on the public site.
  const group = randomUUID();
  await prisma.blogPost.createMany({
    data: [
      { groupId: group, locale: 'tr', slug: 'demo-kucuk-salon-renk-secimi', status: 'DRAFT', styleId: 'iskandinav', title: 'Küçük salonlarda ferahlık veren 5 renk', description: (drafts[3]!.output as { description: string }).description, body: (drafts[3]!.output as { body: string }).body },
      { groupId: randomUUID(), locale: 'tr', slug: 'demo-japandi-yatak-odasi', status: 'DRAFT', styleId: 'japandi', title: 'Japandi yatak odası için 4 öneri', description: 'Japandi yatak odasında doğal malzemeler, alçak mobilyalar ve sade bir renk paletiyle huzurlu bir uyku alanı nasıl kurulur, adım adım anlatıyoruz.', body: (drafts[3]!.output as { body: string }).body },
    ],
  });

  // Firms: an architecture office with projects, members, usage and a pending invitation, and a furniture store.
  const verified = registered.filter((c) => c.id !== customers[11]?.id);
  const office = await prisma.organization.create({ data: { name: 'Ege Mimarlık (demo)', credits: 480, memberMonthlyCap: 40, note: '[demo]', createdAt: daysAgo(25) } });
  const store = await prisma.organization.create({ data: { name: 'Kuzey Mobilya (demo)', credits: 120, note: '[demo]', createdAt: daysAgo(12) } });
  const team = verified.slice(0, 5);
  await prisma.orgMember.createMany({
    data: [
      ...team.map((c, k) => ({ orgId: office.id, userId: c.id, role: (k === 0 ? 'OWNER' : k === 1 ? 'ADMIN' : 'MEMBER') as 'OWNER' | 'ADMIN' | 'MEMBER', monthlyCap: k === 4 ? 15 : null, createdAt: daysAgo(24 - k) })),
      { orgId: store.id, userId: verified[6]!.id, role: 'OWNER', createdAt: daysAgo(12) },
      { orgId: store.id, userId: verified[7]!.id, role: 'MEMBER', createdAt: daysAgo(10) },
    ],
  });
  const villa = await prisma.project.create({ data: { orgId: office.id, name: 'Moda villa', clientName: 'Yılmaz ailesi', createdBy: team[0]!.id, createdAt: daysAgo(20) } });
  const summer = await prisma.project.create({ data: { orgId: office.id, name: 'Bodrum yazlık', clientName: 'Kaya ailesi', createdBy: team[1]!.id, createdAt: daysAgo(14) } });
  await prisma.project.create({ data: { orgId: office.id, name: 'Nişantaşı ofis', clientName: 'Demir Hukuk', status: 'ARCHIVED', createdBy: team[0]!.id, createdAt: daysAgo(40) } });
  // The team's existing demo designs move into the firm: some into projects, the rest stay private to their maker.
  const teamIds = new Set(team.map((c) => c.id));
  const firmDesigns = done.filter((d) => teamIds.has(d.userId)).slice(0, 10);
  for (const [k, d] of firmDesigns.entries()) {
    await prisma.design.update({ where: { id: d.id }, data: { orgId: office.id, projectId: k % 3 === 2 ? null : k % 2 ? summer.id : villa.id } });
    await prisma.orgLedger.create({ data: { orgId: office.id, userId: d.userId, delta: -1, reason: 'generation', refId: d.id, createdAt: d.createdAt } });
  }
  await prisma.orgLedger.createMany({
    data: [
      { orgId: office.id, delta: 500, reason: 'admin: Demo sözleşme yüklemesi', createdAt: daysAgo(25) },
      { orgId: store.id, delta: 120, reason: 'admin: Demo deneme kredisi', createdAt: daysAgo(12) },
    ],
  });
  await prisma.orgInvite.create({
    data: { orgId: office.id, email: `yeni.mimar@${DOMAIN}`, role: 'MEMBER', monthlyCap: 20, tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'), expiresAt: new Date(now + 5 * DAY), createdAt: daysAgo(2) },
  });
  void designs;

  return { tickets: TICKETS.length, broadcasts: 3, drafts: drafts.length, posts: 2, orgs: 2 };
}

if (CLEAR_ONLY) {
  const removed = await resetDemo().finally(() => prisma.$disconnect());
  console.log(`demo: removed ${removed.users} users / ${removed.images} images and every marked row; nothing created`);
} else {
  await main().finally(() => prisma.$disconnect());
}
