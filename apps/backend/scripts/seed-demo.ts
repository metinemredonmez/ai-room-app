// Demo data for the admin panel and screenshots: users, designs with images, reports, KVKK
// applications, store events, AI costs and audit entries spread over the last 60 days.
// Development only. Every run first removes the previous demo rows (users @demo.airoom.local, guest
// devices "demo:*", events "demo-*"); real data is never touched. Usage: npm run db:seed:demo
import 'dotenv/config';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';
import { loadConfig } from '../src/config.js';
import { ROOMS, STYLE_SEED, TOOL_IDS } from '../src/catalog/catalog.data.js';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { createObjectStore } from '../src/images/object-store.js';
import { SAMPLE_IDS, loadSample, type SampleId } from '../src/images/samples.js';
import { INITIAL_LEGAL_VERSION } from '../src/kvkk/legal.js';

const cfg = loadConfig();
if (cfg.NODE_ENV === 'production') {
  console.error('seed-demo is a development tool and refuses to run with NODE_ENV=production');
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: cfg.DATABASE_URL }) });
const store = createObjectStore(cfg, path.resolve(cfg.DATA_DIR, 'images'));

const DOMAIN = 'demo.airoom.local';
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
    where: { OR: [{ email: { endsWith: `@${DOMAIN}` } }, { deviceHash: { startsWith: 'demo:' } }] },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const images = await prisma.image.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
  await store.delete(images.map((i) => `${i.id}.jpg`));
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.aiUsage.deleteMany({ where: { userId: { in: ids } } });
  await prisma.dataRequest.deleteMany({ where: { OR: [{ userId: { in: ids } }, { contactEmail: { endsWith: `@${DOMAIN}` } }] } });
  await prisma.legalDocument.deleteMany({ where: { createdBy: { in: ids }, publishedAt: null } });
  await prisma.webhookEvent.deleteMany({ where: { id: { startsWith: 'demo-' } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); // designs, images, reports, ledger, consents cascade
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
  const staff = await Promise.all([
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
        data: { userId: u.id, entitlement: 'pro', productId: pick(['pro_monthly', 'pro_yearly', 'pro_weekly']), store: pick(['app_store', 'play_store']), environment: 'PRODUCTION', periodType: 'NORMAL', status: 'active', expiresAt: u.planExpiresAt },
      });
    }
    await prisma.consent.createMany({
      data: (['terms', 'privacy', 'ai_processing'] as const).map((kind) => ({ userId: u.id, kind, version: consentVersion, granted: true, ip: null, createdAt })),
    });
    if (u.credits) await prisma.creditLedger.create({ data: { userId: u.id, delta: u.credits + int(0, 10), reason: 'store_purchase', createdAt } });
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
      ...(status !== 'OPEN' ? { resolution: status === 'RESOLVED' ? 'Tasarım öne çıkanlardan kaldırıldı' : 'Politikaya aykırı bir şey bulunmadı', resolvedBy: staff[0].id, resolvedAt: new Date(createdAt.getTime() + DAY) } : {}),
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
        status, response, handledBy: status === 'RECEIVED' ? null : staff[0].id, closedAt: response ? new Date(receivedAt.getTime() + 6 * DAY) : null, createdAt: receivedAt,
      },
    });
  }

  // RevenueCat inbox: processed purchases and renewals, one failed, one unmatched.
  const proUsers = customers.filter((c) => c.pro);
  const events: Prisma.WebhookEventCreateManyInput[] = [];
  for (const [i, u] of proUsers.entries()) {
    const product = pick(['pro_monthly', 'pro_yearly']);
    const at = daysAgo(int(2, 50));
    events.push({ id: `demo-${i}-initial`, source: 'revenuecat', type: 'INITIAL_PURCHASE', appUserId: u.id, userId: u.id, status: 'processed', payload: { product_id: product, store: 'APP_STORE', environment: 'PRODUCTION' }, receivedAt: at, processedAt: at });
    if (i % 2) events.push({ id: `demo-${i}-renewal`, source: 'revenuecat', type: 'RENEWAL', appUserId: u.id, userId: u.id, status: 'processed', payload: { product_id: product, store: 'PLAY_STORE', environment: 'PRODUCTION' }, receivedAt: daysAgo(1), processedAt: daysAgo(1) });
  }
  events.push(
    { id: 'demo-failed-1', source: 'revenuecat', type: 'NON_RENEWING_PURCHASE', appUserId: customers[0]!.id, userId: customers[0]!.id, status: 'failed', error: 'subscriber_sync_timeout', payload: { product_id: 'credits_10', store: 'APP_STORE', environment: 'PRODUCTION' }, receivedAt: daysAgo(0) },
    { id: 'demo-unmatched-1', source: 'revenuecat', type: 'INITIAL_PURCHASE', appUserId: '$RCAnonymousID:demo', status: 'unmatched', payload: { product_id: 'pro_weekly', store: 'PLAY_STORE', environment: 'SANDBOX' }, receivedAt: daysAgo(3) },
  );
  await prisma.webhookEvent.createMany({ data: events });

  // A draft legal text and a few audit entries by the demo staff.
  await prisma.legalDocument.create({
    data: { kind: 'marketing', version: '2026-12-01', locale: 'tr', title: 'Ticari Elektronik İleti Onayı (taslak)', body: 'Bu metin demo amaçlı bir taslaktır. Kampanya ve yeniliklerden e-posta ve bildirim yoluyla haberdar olmak için onay verirsin; onayını istediğin an geri çekebilirsin.', requiresConsent: true, createdBy: staff[1].id },
  });
  await prisma.auditLog.createMany({
    data: [
      { actorId: staff[0].id, action: 'report.resolve', targetType: 'report', targetId: null, meta: { status: 'RESOLVED' }, createdAt: daysAgo(3) },
      { actorId: staff[1].id, action: 'design.feature', targetType: 'design', targetId: done[2]!.id, meta: { featured: true }, createdAt: daysAgo(5) },
      { actorId: staff[1].id, action: 'style.update', targetType: 'style', targetId: 'japandi', meta: { fields: ['descriptionTr'] }, createdAt: daysAgo(8) },
      { actorId: staff[0].id, action: 'kvkk.request_update', targetType: 'data_request', targetId: null, meta: { status: 'IN_PROGRESS' }, createdAt: daysAgo(2) },
      { actorId: staff[1].id, action: 'legal.draft_create', targetType: 'legal', targetId: null, meta: { kind: 'marketing', version: '2026-12-01', locale: 'tr' }, createdAt: daysAgo(1) },
    ],
  });

  console.log(
    `demo: removed ${removed.users} users / ${removed.images} images; created ${staff.length} staff, ${customers.length} customers, ` +
      `${designs.length} designs, ${reports.length} reports, ${kvkk.length} KVKK applications, ${events.length} store events`,
  );
}

await main().finally(() => prisma.$disconnect());
