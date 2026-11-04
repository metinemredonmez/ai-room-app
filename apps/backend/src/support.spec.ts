import { randomUUID } from 'node:crypto';
import { CreateTicketSchema, MAX_OPEN_PER_USER, SupportService } from './support/support.service.js';

// API.md §7.19: support tickets. AZ-01 (own tickets only), INP-01 (bounded input), notification only to verified
// addresses and registered devices, the team mail without the message itself.

type Row = Record<string, unknown> & { id: string; userId: string; status: string };

function service(users: Record<string, { email: string | null; emailVerifiedAt: Date | null; locale: string; pushTokens: Array<{ token: string }> }> = {}) {
  const tickets: Row[] = [];
  const messages: Array<Record<string, unknown>> = [];
  const mails: Array<{ to: string; subject: string; text: string }> = [];
  const pushes: unknown[] = [];
  const withMessages = (t: Row) => ({ ...t, messages: messages.filter((m) => m.ticketId === t.id) });
  const match = (t: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'not' in v ? t[k] !== (v as { not: unknown }).not : t[k] === v));
  const prisma = {
    supportTicket: {
      count: async ({ where }: { where: Record<string, unknown> }) => tickets.filter((t) => match(t, where)).length,
      create: async ({ data }: { data: Record<string, unknown> & { messages: { create: Record<string, unknown> } } }) => {
        const { messages: m, ...rest } = data;
        const row = { id: randomUUID(), status: 'OPEN', userUnread: false, closedAt: null, lastMessageAt: new Date(), createdAt: new Date(), ...rest } as unknown as Row;
        tickets.push(row);
        messages.push({ id: randomUUID(), ticketId: row.id, createdAt: new Date(), ...m.create });
        return row;
      },
      findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
        const t = tickets.find((x) => x.id === where.id && x.userId === where.userId);
        return t ? withMessages(t) : null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const t = tickets.find((x) => x.id === where.id);
        return t ? { ...withMessages(t), user: { id: t.userId, createdAt: new Date(), ...users[t.userId] } } : null;
      },
      findMany: async () => tickets,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(tickets.find((t) => t.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = tickets.filter((t) => match(t, where));
        for (const t of hit) Object.assign(t, data);
        return { count: hit.length };
      },
    },
    supportMessage: { create: async ({ data }: { data: Record<string, unknown> }) => messages.push({ id: randomUUID(), createdAt: new Date(), ...data }) },
    design: { findFirst: async () => null },
    user: { findUnique: async () => ({ locale: 'tr' }) },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  };
  const mailer = { send: async (m: { to: string; subject: string; text: string }) => void mails.push(m) };
  const push = { send: async (m: unknown) => void pushes.push(m) };
  const cfg = { LEGAL_CONTACT_EMAIL: 'destek@example.com', ADMIN_APP_URL: 'https://admin.example', WEB_APP_URL: 'https://casalume.example' };
  const svc = new SupportService(prisma as never, mailer as never, push as never, cfg as never);
  return { svc, tickets, messages, mails, pushes };
}

const input = { category: 'bug' as const, subject: 'Tasarım yüklenmiyor', body: 'Stüdyoda fotoğraf yükleyince hata alıyorum.' };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('support tickets', () => {
  it('bounds the input (INP-01)', () => {
    expect(CreateTicketSchema.safeParse(input).success).toBe(true);
    expect(CreateTicketSchema.safeParse({ ...input, body: 'kısa' }).success).toBe(false);
    expect(CreateTicketSchema.safeParse({ ...input, category: 'refund_now' }).success).toBe(false);
    expect(CreateTicketSchema.safeParse({ ...input, requestId: 'bad id with spaces' }).success).toBe(false);
    expect(CreateTicketSchema.safeParse({ ...input, extra: 1 }).success).toBe(false);
  });

  it('a user only sees their own tickets (AZ-01)', async () => {
    const { svc } = service();
    const mine = await svc.create('u1', input);
    await expect(svc.getMine('u2', mine.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.replyMine('u2', mine.id, 'Merhaba')).rejects.toMatchObject({ status: 404 });
    expect((await svc.getMine('u1', mine.id)).messages).toHaveLength(1);
  });

  it('caps open tickets per user', async () => {
    const { svc } = service();
    for (let i = 0; i < MAX_OPEN_PER_USER; i++) await svc.create('u1', input);
    await expect(svc.create('u1', input)).rejects.toMatchObject({ status: 409, code: 'too_many_open_tickets' });
    await expect(svc.create('u2', input)).resolves.toBeTruthy();
  });

  it('tells the team without the message itself', async () => {
    const { svc, mails } = service();
    await svc.create('u1', input);
    await flush();
    expect(mails[0].to).toBe('destek@example.com');
    expect(mails[0].text).toContain('Tasarım yüklenmiyor');
    expect(mails[0].text).not.toContain('fotoğraf yükleyince');
  });

  it('a team reply notifies by e-mail only a verified address and by push only registered devices', async () => {
    const { svc, tickets, mails, pushes } = service({
      u1: { email: 'a@example.com', emailVerifiedAt: new Date(), locale: 'de', pushTokens: [{ token: 'ExponentPushToken[aaaaaaaaaa]' }] },
      u2: { email: 'b@example.com', emailVerifiedAt: null, locale: 'tr', pushTokens: [] },
    });
    const t1 = await svc.create('u1', input);
    const t2 = await svc.create('u2', input);
    mails.length = 0;
    await svc.adminReply(t1.id, 'staff', 'Sorunu düzelttik, yeniden dener misin?');
    await svc.adminReply(t2.id, 'staff', 'Yanıt');
    await flush();
    expect(mails.map((m) => m.to)).toEqual(['a@example.com']);
    expect(mails[0].subject).toContain('A reply to your support request'); // German user: English copy (TR/EN only)
    expect(mails[0].text).toContain('https://casalume.example/de/destek?t=');
    expect(pushes).toHaveLength(1);
    expect(tickets.find((t) => t.id === t1.id)).toMatchObject({ status: 'ANSWERED', userUnread: true });
  });

  it('opening marks the reply read; the user answering reopens the ticket', async () => {
    const { svc, tickets } = service({ u1: { email: null, emailVerifiedAt: null, locale: 'tr', pushTokens: [] } });
    const t = await svc.create('u1', input);
    await svc.adminReply(t.id, 'staff', 'Yanıt');
    await svc.adminClose(t.id);
    expect(tickets[0]).toMatchObject({ status: 'CLOSED', userUnread: true });
    expect((await svc.getMine('u1', t.id)).userUnread).toBe(false);
    await svc.replyMine('u1', t.id, 'Hâlâ olmuyor');
    expect(tickets[0]).toMatchObject({ status: 'OPEN', closedAt: null });
  });
});
