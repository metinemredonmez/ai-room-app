import { unsubscribeKey, unsubscribeSignature } from './broadcasts/broadcast.mail.js';
import { confirmMail, leaveKey, leaveSignature, maskEmail, normalizeEmail, parseWaitlistSettings, SignupSchema, verifyLeaveSignature, webPath } from './waitlist/waitlist.rules.js';
import { WaitlistCampaignsService } from './waitlist/waitlist-campaigns.service.js';

// API.md §7.47: waiting list and newsletter. Consent is required, one row per mailbox, the leave link cannot be forged
// or replayed from another kind of link, and the confirmation token never sits in a URL path or query.

describe('waitlist signup input', () => {
  const base = { email: 'Ayse@Example.com', consent: true };
  it('needs ticked consent and a real address; platforms are ios / android once each; unknown fields refused', () => {
    expect(SignupSchema.parse(base)).toMatchObject({ locale: 'tr', platforms: [], source: 'home' });
    expect(SignupSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(SignupSchema.safeParse({ email: base.email }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...base, platforms: ['ios', 'ios'] }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...base, platforms: ['windows'] }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...base, locale: 'pt' }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...base, role: 'ADMIN' }).success).toBe(false);
    expect(SignupSchema.parse({ ...base, website: 'spam' }).website).toBe('spam');
  });

  it('one row per mailbox however it is typed; the admin sees a masked address', () => {
    expect(normalizeEmail('  Ayse@Example.COM ')).toBe('ayse@example.com');
    expect(maskEmail('ayse@example.com')).toBe('a***@example.com');
    expect(maskEmail('broken')).toBe('***');
  });

  it('settings default to open; junk falls back', () => {
    expect(parseWaitlistSettings(undefined)).toEqual({ settings: { enabled: true }, ok: true });
    expect(parseWaitlistSettings({ enabled: 'yes' }).ok).toBe(false);
  });
});

describe('waitlist links', () => {
  const key = leaveKey('test-secret-test-secret-test-secret');
  it('the leave signature is bound to the entry and cannot be taken from a broadcast unsubscribe link', () => {
    const id = '0b8f3a3c-5a3e-4c1b-9b8e-2f1c3d4e5f60';
    const sig = leaveSignature(id, key);
    expect(verifyLeaveSignature(id, sig, key)).toBe(true);
    expect(verifyLeaveSignature('11111111-2222-4333-8444-555555555555', sig, key)).toBe(false);
    expect(verifyLeaveSignature(id, `${sig.slice(0, -1)}x`, key)).toBe(false);
    expect(verifyLeaveSignature(id, unsubscribeSignature(id, unsubscribeKey('test-secret-test-secret-test-secret')), key)).toBe(false);
  });

  it('links open in the visitor\'s language and the confirmation token travels in the fragment only', () => {
    expect(webPath('https://casalume.app/', 'tr', '/bekleme-listesi/onay')).toBe('https://casalume.app/bekleme-listesi/onay');
    expect(webPath('https://casalume.app', 'de', '/bekleme-listesi/onay')).toBe('https://casalume.app/de/bekleme-listesi/onay');
    const url = 'https://casalume.app/bekleme-listesi/onay#token=abc';
    const tr = confirmMail('ayse@example.com', 'tr', url);
    expect(tr.subject).toContain('Bekleme listesi');
    expect(tr.html).toContain(url);
    expect(new URL(url).search).toBe('');
    expect(confirmMail('x@example.com', 'ja', url).subject).toContain('Confirm');
  });
});

describe('waitlist campaigns (API.md §7.47)', () => {
  const quiet = { quietStart: '21:00', quietEnd: '09:00', emailDailyCap: 300 };
  const campaignsSvc = (
    entries: Array<{ id: string; email: string; locale: string; status: string }>,
    opts: { capUsed?: number; now?: Date; mailError?: boolean } = {},
  ) => {
    const sends: Array<{ campaignId: string; entryId: string }> = [];
    const mails: unknown[] = [];
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const row: Record<string, unknown> = { id: 'c1', subject: 'Yayında!', body: 'Casalume indirildi.', kind: 'NEWSLETTER', status: 'DRAFT', targetCount: 0, sentCount: 0, failedCount: 0, error: null };
    const prisma = {
      waitlistEntry: {
        findMany: async ({ where, take }: { where: { id?: { gt: string } }; take: number }) =>
          entries.filter((e) => e.status === 'CONFIRMED' && e.id > (where.id?.gt ?? '') && !sends.some((s) => s.entryId === e.id)).slice(0, take).map((e) => ({ id: e.id })),
        findUnique: async ({ where: { id } }: { where: { id: string } }) => entries.find((e) => e.id === id) ?? null,
        count: async () => entries.filter((e) => e.status === 'CONFIRMED').length,
      },
      waitlistCampaign: {
        findUnique: async () => ({ ...row }),
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data }),
        update: async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id, data });
          Object.assign(row, data);
          return { ...row };
        },
        updateMany: async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id, data });
          Object.assign(row, data);
          return { count: 1 };
        },
      },
      waitlistCampaignSend: {
        create: async ({ data }: { data: { campaignId: string; entryId: string } }) => {
          sends.push(data);
        },
        count: async () => sends.length,
      },
    };
    const mailer = { send: async (m: unknown) => {
      mails.push(m);
      if (opts.mailError) throw new Error('smtp down');
    } };
    const queues = { waitlist: { add: async () => undefined } };
    const settings = { current: { broadcast: quiet } };
    const broadcasts = { emailSentToday: async () => opts.capUsed ?? 0 };
    const waitlist = { leaveUrl: (id: string, locale: string) => `https://casalume.app/${locale === 'tr' ? '' : `${locale}/`}bekleme-listesi/cik?i=${id}&t=sig` };
    const svc = new WaitlistCampaignsService(prisma as never, mailer as never, queues as never, settings as never, broadcasts as never, waitlist as never, {} as never);
    return { svc, mails, sends, updates };
  };

  it('flags commercial wording at compose time', async () => {
    const { svc } = campaignsSvc([]);
    const out = await svc.create('u1', { subject: 'İndirim başladı', body: 'Bugüne özel %50 indirim kaçmaz!', kind: 'NEWSLETTER' });
    expect((out as { commercial: boolean }).commercial).toBe(true);
  });

  it('sends one localized mail per confirmed entry, with the one-click leave link', async () => {
    const { svc, mails } = campaignsSvc([
      { id: 'a1', email: 'ayse@example.com', locale: 'tr', status: 'CONFIRMED' },
      { id: 'b2', email: 'sam@example.com', locale: 'en', status: 'CONFIRMED' },
      { id: 'c3', email: 'left@example.com', locale: 'tr', status: 'UNSUBSCRIBED' },
    ]);
    const out = (await svc.process('c1', 0)) as { status: string };
    expect(out.status).toBe('SENT');
    expect(mails).toHaveLength(2);
    const tr = mails[0] as { to: string; headers: Record<string, string>; html: string };
    expect(tr.to).toBe('ayse@example.com');
    expect(tr.headers['List-Unsubscribe']).toContain('/bekleme-listesi/cik?i=a1&t=sig');
    expect(tr.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(tr.html).toContain('ayrıl');
    const en = mails[1] as { to: string; html: string };
    expect(en.html).toContain('Leave the list');
  });

  it('never mails the same entry twice (unique campaign+entry; resume continues)', async () => {
    const entries = [{ id: 'a1', email: 'a@example.com', locale: 'tr', status: 'CONFIRMED' }];
    const { svc, mails } = campaignsSvc(entries);
    await svc.process('c1', 0);
    await svc.process('c1', 0); // a re-run (e.g. after a crash) finds nothing new
    expect(mails).toHaveLength(1);
  });

  it('a failed mail is not retried to an entry that left before the next run', async () => {
    const entries = [
      { id: 'a1', email: 'a@example.com', locale: 'tr', status: 'CONFIRMED' },
      { id: 'b2', email: 'b@example.com', locale: 'tr', status: 'CONFIRMED' },
    ];
    // First run: a1's mail fails (SMTP hiccup) and a1 leaves the list before the retry.
    const first = campaignsSvc(entries, { mailError: true });
    const r1 = (await first.svc.process('c1', 0)) as { status: string };
    expect(r1.status).toBe('SENT'); // b2 was mailed; the failed one is counted, not re-queued in this design
    entries[0] = { ...entries[0], status: 'UNSUBSCRIBED' };
    const second = campaignsSvc(entries);
    const r2 = (await second.svc.process('c1', 0)) as { status: string };
    expect(r2.status).toBe('SENT');
    expect(second.mails).toHaveLength(1); // only b2 — a1 is skipped, never re-mailed
    expect((second.mails[0] as { to: string }).to).toBe('b@example.com');
  });

  it('pauses at the shared daily cap and schedules a resume', async () => {
    const { svc, mails, updates } = campaignsSvc(
      [{ id: 'a1', email: 'a@example.com', locale: 'tr', status: 'CONFIRMED' }],
      { capUsed: 300 },
    );
    const out = (await svc.process('c1', 0)) as { paused: string };
    expect(out.paused).toBe('email_daily_cap');
    expect(mails).toHaveLength(0);
    expect(updates.some((u) => u.data.status === 'PAUSED' && u.data.error === 'email_daily_cap')).toBe(true);
  });

  it('stops cleanly when cancelled', async () => {
    const { svc } = campaignsSvc([{ id: 'a1', email: 'a@example.com', locale: 'tr', status: 'CONFIRMED' }]);
    await svc.cancel('c1'); // DRAFT → CANCELLED
    const out = (await svc.process('c1', 0)) as { skipped: string };
    expect(out.skipped).toBe('cancelled');
  });
});
