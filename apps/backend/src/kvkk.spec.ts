import type { Config } from './config.js';
import type { PrismaService } from './common/infra.js';
import type { DataRequest, User } from './generated/prisma/client.js';
import { ConsentsService } from './kvkk/consents.service.js';
import { DataRequestsService, daysLeft, dueFrom, MAX_OPEN_PER_USER, RESPONSE_DAYS } from './kvkk/data-requests.service.js';
import { LEGAL_VERSION_RE } from './kvkk/legal.js';
import { HTML_TAG, LegalService } from './kvkk/legal.service.js';
import type { MailerService } from './mail/mailer.service.js';

const DAY = 86_400_000;
const cfg = {
  LEGAL_CONTROLLER_NAME: 'AI Room Teknoloji A.Ş.', LEGAL_CONTROLLER_ADDRESS: 'İstanbul', LEGAL_CONTACT_EMAIL: 'kvkk@airoom.example.com',
  WEB_APP_URL: 'https://airoom.example.com', ADMIN_APP_URL: 'https://admin.airoom.example.com',
} as Config;

type Row = { kind: string; version: string; requiresConsent: boolean; publishedAt: Date | null };
const published = (kind: string, version: string, requiresConsent = true): Row => ({ kind, version, requiresConsent, publishedAt: new Date() });

/** LegalService over a fake table; `reload` reads it like Prisma would (newest version first). */
function legalWith(rows: Row[], extra: Record<string, unknown> = {}) {
  const prisma = {
    legalDocument: {
      findMany: vi.fn(async () => [...rows].sort((a, b) => (a.version < b.version ? 1 : -1))),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: object }) => ({ id: 'd1', ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      ...extra,
    },
  } as unknown as PrismaService;
  return { legal: new LegalService(prisma, cfg), prisma };
}

describe('legal texts (KVKK m.10)', () => {
  it('orders versions as strings: same-day fixes sort between days', () => {
    for (const v of ['2026-11-01', '2026-11-01.1', '2026-11-01.9']) expect(LEGAL_VERSION_RE.test(v)).toBe(true);
    for (const v of ['2026-11-1', '2026-11-01.0', '2026-11-01.10', '2026-11-01 ', 'v1']) expect(LEGAL_VERSION_RE.test(v)).toBe(false);
    expect(['2026-11-02', '2026-11-01.1', '2026-11-01'].sort()).toEqual(['2026-11-01', '2026-11-01.1', '2026-11-02']);
  });

  it('keeps earlier acceptances valid across wording fixes, not across a version that needs consent', async () => {
    const { legal } = legalWith([published('privacy', '2026-11-01'), published('privacy', '2026-11-05', false), published('terms', '2026-11-01'), published('terms', '2026-11-07')]);
    await legal.reload();
    expect(legal.versionOf('privacy')).toMatchObject({ version: '2026-11-05', consentVersion: '2026-11-01' });
    expect(legal.acceptanceValid('privacy', '2026-11-01')).toBe(true);
    expect(legal.versionOf('terms')).toMatchObject({ version: '2026-11-07', consentVersion: '2026-11-07' });
    expect(legal.acceptanceValid('terms', '2026-11-01')).toBe(false);
    expect(legal.acceptanceValid('terms', '2026-11-07')).toBe(true);
  });

  it('treats the oldest version as needing consent even if flagged otherwise', async () => {
    const { legal } = legalWith([published('marketing', '2026-11-01', false), published('marketing', '2026-11-03', false)]);
    await legal.reload();
    expect(legal.versionOf('marketing').consentVersion).toBe('2026-11-01');
  });

  it('fills the controller placeholders and leaves unknown ones visible', () => {
    const { legal } = legalWith([]);
    expect(legal.render('{{controller.name}} · {{ controller.email }} · KEP {{controller.kep}} · {{controller.phone}}'))
      .toBe('AI Room Teknoloji A.Ş. · kvkk@airoom.example.com · KEP — · {{controller.phone}}');
  });

  it('refuses HTML in drafts (WEB-01) and versions that are not newer than the published one', async () => {
    expect(HTML_TAG.test('<script>alert(1)</script>')).toBe(true);
    expect(HTML_TAG.test('<img src=x onerror=alert(1)>')).toBe(true);
    expect(HTML_TAG.test('a < b ve c > d; 3<5')).toBe(false);
    const { legal } = legalWith([published('privacy', '2026-11-01')]);
    await legal.reload();
    const draft = { kind: 'privacy' as const, locale: 'tr' as const, title: 'Aydınlatma', body: 'x'.repeat(60), requiresConsent: true };
    await expect(legal.createDraft({ ...draft, version: '2026-11-02', body: '<iframe src="https://evil.example.com">' }, 'a1')).rejects.toMatchObject({ status: 400 });
    await expect(legal.createDraft({ ...draft, version: '2026-11-01' }, 'a1')).rejects.toMatchObject({ status: 409 });
    await expect(legal.createDraft({ ...draft, version: '2026-10-30' }, 'a1')).rejects.toMatchObject({ status: 409 });
    await expect(legal.createDraft({ ...draft, version: '2026-11-01.1' }, 'a1')).resolves.toMatchObject({ version: '2026-11-01.1', createdBy: 'a1' });
  });

  it('never edits a published text and publishes only with a Turkish draft', async () => {
    const live = { id: 'p1', publishedAt: new Date(), title: 't', body: 'b' };
    const { legal } = legalWith([published('privacy', '2026-11-01')], { findUnique: vi.fn(async () => live) });
    await legal.reload();
    await expect(legal.updateDraft('p1', { body: 'y'.repeat(60) })).rejects.toMatchObject({ status: 409 });

    const enOnly = legalWith([published('privacy', '2026-11-01')]);
    enOnly.prisma.legalDocument.findMany = vi.fn(async () => [{ locale: 'en', requiresConsent: true }]) as never;
    await expect(enOnly.legal.publish('privacy', '2026-11-04', 'a1')).rejects.toMatchObject({ status: 400 });
  });

  it('refuses to publish an older version and loses a race against a parallel publish', async () => {
    const { legal, prisma } = legalWith([published('privacy', '2026-11-05')]);
    await legal.reload();
    prisma.legalDocument.findMany = vi.fn(async () => [{ locale: 'tr', requiresConsent: true }]) as never;
    await expect(legal.publish('privacy', '2026-11-03', 'a1')).rejects.toMatchObject({ status: 409 });

    const raced = legalWith([], { findUnique: vi.fn(async () => ({ id: 'd1', publishedAt: null, title: 'Taslak', body: 'z'.repeat(60) })), updateMany: vi.fn(async () => ({ count: 0 })) });
    await expect(raced.legal.updateDraft('d1', { title: 'Yeni başlık' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('consents follow the published version', () => {
  const { legal } = legalWith([published('marketing', '2026-11-01'), published('marketing', '2026-11-04')]);
  const create = vi.fn(async ({ data }: { data: { kind: string; version: string; granted: boolean } }) => ({ ...data, createdAt: new Date() }));
  const consents = new ConsentsService({ consent: { create } } as unknown as PrismaService, legal);
  beforeAll(() => legal.reload());

  it('rejects a grant for a text the user did not see, always records a withdrawal', async () => {
    await expect(consents.record('u1', 'marketing', '2026-11-01', true)).rejects.toMatchObject({ status: 409 });
    expect(create).not.toHaveBeenCalled();
    await expect(consents.record('u1', 'marketing', '2026-11-04', true)).resolves.toMatchObject({ version: '2026-11-04', granted: true });
    // A withdrawal is honoured whatever version the client sends, and logged against the current text.
    await expect(consents.record('u1', 'marketing', '2020-01-01', false)).resolves.toMatchObject({ version: '2026-11-04', granted: false });
  });
});

describe('KVKK m.11 applications', () => {
  const user = { id: 'u1', email: 'user@example.com' } as User;
  const row = (over: Partial<DataRequest> = {}) => {
    const receivedAt = new Date(Date.now() - 2 * DAY);
    return { id: 'r1', reference: 'KVKK-2026-ABC234', userId: 'u1', type: 'erasure', channel: 'app', contactEmail: null, details: 'Hesabımı silin lütfen.', status: 'RECEIVED',
      receivedAt, dueAt: dueFrom(receivedAt), response: null, handledBy: null, closedAt: null, createdAt: receivedAt, updatedAt: receivedAt, ...over } as DataRequest;
  };
  const setup = (db: Record<string, unknown>) => {
    const send = vi.fn(async () => undefined);
    const service = new DataRequestsService({ dataRequest: db } as unknown as PrismaService, { send } as unknown as MailerService, cfg);
    return { service, send };
  };

  it('is due 30 days after it arrived and counts days left in whole days', () => {
    const at = new Date('2026-11-03T09:00:00Z');
    expect(dueFrom(at).toISOString()).toBe('2026-12-03T09:00:00.000Z');
    expect(RESPONSE_DAYS).toBe(30);
    expect(daysLeft(dueFrom(at), at.getTime())).toBe(30);
    expect(daysLeft(dueFrom(at), at.getTime() + 29.5 * DAY)).toBe(1);
    expect(daysLeft(dueFrom(at), at.getTime() + 32 * DAY)).toBe(-2);
  });

  it('allows at most 3 open applications per user (RES-01)', async () => {
    const create = vi.fn();
    const { service } = setup({ count: vi.fn(async () => MAX_OPEN_PER_USER), create });
    await expect(service.create(user, 'erasure', 'Hesabımı silin lütfen.')).rejects.toMatchObject({ status: 409, code: 'too_many_open_requests' });
    expect(create).not.toHaveBeenCalled();
  });

  it('gives a reference and a deadline, and mails both sides without the details', async () => {
    const create = vi.fn(async ({ data }: { data: Partial<DataRequest> }) => row({ ...data, id: 'r2' }));
    const { service, send } = setup({ count: vi.fn(async () => 0), create });
    const dto = await service.create(user, 'erasure', 'Gizli ayrıntı: telefonum 0555');
    expect(dto.reference).toMatch(/^KVKK-\d{4}-[A-Z2-9]{6}$/);
    expect(new Date(dto.dueAt).getTime() - new Date(dto.receivedAt).getTime()).toBe(30 * DAY);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const mails = JSON.stringify(send.mock.calls);
    expect(mails).toContain('user@example.com');
    expect(mails).toContain('kvkk@airoom.example.com');
    expect(mails).not.toContain('0555');
  });

  it('follows RECEIVED → IN_PROGRESS → COMPLETED|REJECTED and needs an answer to close', async () => {
    const findUnique = vi.fn(async () => ({ ...row({ status: 'COMPLETED' }), user: { email: 'user@example.com' } }));
    const { service } = setup({ findUnique, updateMany: vi.fn() });
    await expect(service.update('r1', 'a1', { status: 'IN_PROGRESS' })).rejects.toMatchObject({ status: 409 });

    findUnique.mockResolvedValue({ ...row(), user: { email: 'user@example.com' } });
    await expect(service.update('r1', 'a1', { status: 'COMPLETED' })).rejects.toMatchObject({ status: 400 });
  });

  it('lets only one admin close an application (BUS race) and e-mails the answer once', async () => {
    const findUnique = vi.fn(async () => ({ ...row({ status: 'IN_PROGRESS' }), user: { email: 'user@example.com' } }));
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const { service, send } = setup({ findUnique, updateMany, findUniqueOrThrow: vi.fn(async () => row({ status: 'COMPLETED' })) });
    await expect(service.update('r1', 'a1', { status: 'COMPLETED', response: 'Hesabın ve verilerin silindi.' })).rejects.toMatchObject({ status: 409 });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r1', status: 'IN_PROGRESS' } }));
    expect(send).not.toHaveBeenCalled();

    updateMany.mockResolvedValue({ count: 1 });
    await expect(service.update('r1', 'a1', { status: 'COMPLETED', response: 'Hesabın ve verilerin silindi.' })).resolves.toMatchObject({ status: 'COMPLETED' });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(send.mock.calls)).toContain('KVKK m.14');
  });

  it('marks overdue open applications for the admin desk', () => {
    const { service } = setup({});
    const late = service.toAdminDto(row({ receivedAt: new Date(Date.now() - 31 * DAY), dueAt: new Date(Date.now() - DAY) }));
    expect(late).toMatchObject({ overdue: true, daysLeft: -1 });
    expect(service.toAdminDto(row({ status: 'COMPLETED', dueAt: new Date(Date.now() - DAY) }))).toMatchObject({ overdue: false, daysLeft: null });
  });
});
