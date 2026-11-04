import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { contentLocale } from '../catalog/catalog.data.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { CONFIG, type Config } from '../config.js';
import type { Prisma, SupportMessage, SupportStatus, SupportTicket } from '../generated/prisma/client.js';
import { MailerService, renderActionMail } from '../mail/mailer.service.js';
import { PushService, type PushMessage } from '../push/push.service.js';

// Support requests (API.md §7.19): the user writes from the app or the web, the team answers in the admin, the user
// gets an e-mail and a push. AZ-01: a user only ever sees their own tickets.

export const SUPPORT_CATEGORIES = ['bug', 'billing', 'account', 'design', 'idea', 'other'] as const;
export const MAX_OPEN_PER_USER = 5;
const DAY = 86_400_000;
const KEEP_CLOSED_DAYS = 730;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const body = z.string().trim().min(1).max(4000);
export const CreateTicketSchema = z
  .object({
    category: z.enum(SUPPORT_CATEGORIES),
    subject: z.string().trim().min(3).max(120),
    body: z.string().trim().min(10).max(4000),
    requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
    designId: z.uuid().optional(),
    platform: z.enum(['web', 'ios', 'android']).optional(),
    appVersion: z.string().regex(/^[0-9A-Za-z.+-]{1,20}$/).optional(),
  })
  .strict();
export type CreateTicket = z.infer<typeof CreateTicketSchema>;
export const MessageSchema = z.object({ body }).strict();

const newReference = (now = new Date()) =>
  `DST-${now.getUTCFullYear()}-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;
const notFound = () => new AppError(404, 'not_found', 'Destek talebi bulunamadı');

const COPY = {
  tr: {
    subject: (ref: string) => `Casalume · Destek talebine yanıt (${ref})`,
    heading: 'Destek ekibinden yanıt',
    about: (s: string) => `Talebin: ${s}`,
    cta: 'Yanıtı aç',
    footer: 'Bu e-postayı Casalume destek talebin yanıtlandığı için aldın.',
    pushTitle: 'Destek ekibinden yanıt',
  },
  en: {
    subject: (ref: string) => `Casalume · A reply to your support request (${ref})`,
    heading: 'A reply from support',
    about: (s: string) => `Your request: ${s}`,
    cta: 'Open the reply',
    footer: 'You are receiving this because your Casalume support request was answered.',
    pushTitle: 'A reply from support',
  },
} as const;

type TicketWithMessages = SupportTicket & { messages: SupportMessage[] };

@Injectable()
export class SupportService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private push: PushService,
    @Inject(CONFIG) private cfg: Config,
  ) {}

  // ------------------------------------------------------------------------------------------------- user

  async create(userId: string, input: CreateTicket) {
    const open = await this.prisma.supportTicket.count({ where: { userId, status: { not: 'CLOSED' } } });
    if (open >= MAX_OPEN_PER_USER) {
      throw new AppError(409, 'too_many_open_tickets', `Aynı anda en çok ${MAX_OPEN_PER_USER} açık talebin olabilir; yanıtlananları kapatınca yenisini açabilirsin`);
    }
    if (input.designId && !(await this.prisma.design.findFirst({ where: { id: input.designId, userId }, select: { id: true } }))) {
      throw new AppError(404, 'not_found', 'Tasarım bulunamadı');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
    let ticket: SupportTicket | null = null;
    for (let attempt = 0; !ticket; attempt++) {
      try {
        ticket = await this.prisma.supportTicket.create({
          data: {
            reference: newReference(), userId, category: input.category, subject: input.subject,
            requestId: input.requestId ?? null, designId: input.designId ?? null, platform: input.platform ?? null,
            appVersion: input.appVersion ?? null, locale: user?.locale ?? 'tr',
            messages: { create: { author: 'USER', body: input.body } },
          },
        });
      } catch (e) {
        const unique = (e as { code?: string }).code === 'P2002';
        if (!unique || attempt >= 2) throw e;
      }
    }
    log.info('support_ticket_created', { reference: ticket.reference, category: ticket.category });
    this.notifyTeam(ticket);
    return this.getMine(userId, ticket.id);
  }

  async listMine(userId: string) {
    const rows = await this.prisma.supportTicket.findMany({ where: { userId }, orderBy: { lastMessageAt: 'desc' }, take: 50 });
    return { items: rows.map((t) => this.summary(t)) };
  }

  /** Opening the ticket marks the team's reply as read. */
  async getMine(userId: string, id: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, userId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!t) throw notFound();
    if (t.userUnread) await this.prisma.supportTicket.update({ where: { id }, data: { userUnread: false } });
    return this.detail({ ...t, userUnread: false });
  }

  /** The user's answer reopens an answered or closed ticket. */
  async replyMine(userId: string, id: string, text: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, userId }, select: { id: true } });
    if (!t) throw notFound();
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { ticketId: id, author: 'USER', body: text } }),
      this.prisma.supportTicket.update({ where: { id }, data: { status: 'OPEN', closedAt: null, lastMessageAt: new Date() } }),
    ]);
    return this.getMine(userId, id);
  }

  // ------------------------------------------------------------------------------------------------ admin

  async adminList(q: { status?: SupportStatus; cursor?: string; limit: number }) {
    const where: Prisma.SupportTicketWhereInput = q.status ? { status: q.status } : {};
    const rows = await this.prisma.supportTicket.findMany({
      where,
      include: { user: { select: { email: true, isGuest: true, plan: true } } },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.limit);
    const counts = await this.prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } });
    const n = (s: SupportStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
    return {
      items: page.map((t) => ({ ...this.summary(t), user: { email: t.user.email, isGuest: t.user.isGuest, plan: t.user.plan } })),
      nextCursor: rows.length > q.limit ? page[page.length - 1].id : null,
      counts: { OPEN: n('OPEN'), ANSWERED: n('ANSWERED'), CLOSED: n('CLOSED') },
    };
  }

  async adminGet(id: string) {
    const t = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        user: { select: { id: true, email: true, name: true, isGuest: true, plan: true, locale: true, createdAt: true } },
      },
    });
    if (!t) throw notFound();
    return { ...this.detail(t), user: { ...t.user, createdAt: t.user.createdAt.toISOString() } };
  }

  /** The team's answer: the ticket becomes ANSWERED and the user gets an e-mail and a push in their language. */
  async adminReply(id: string, staffId: string, text: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id }, include: { user: { select: { email: true, emailVerifiedAt: true, locale: true, pushTokens: { select: { token: true } } } } } });
    if (!t) throw notFound();
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { ticketId: id, author: 'STAFF', staffId, body: text } }),
      this.prisma.supportTicket.update({ where: { id }, data: { status: 'ANSWERED', closedAt: null, userUnread: true, lastMessageAt: new Date() } }),
    ]);
    this.notifyUser(t, text);
    return this.adminGet(id);
  }

  async adminClose(id: string) {
    const { count } = await this.prisma.supportTicket.updateMany({ where: { id, status: { not: 'CLOSED' } }, data: { status: 'CLOSED', closedAt: new Date() } });
    if (!count && !(await this.prisma.supportTicket.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
    return this.adminGet(id);
  }

  /** KVKK data minimisation: closed tickets go after 2 years. */
  async purgeClosed() {
    const { count } = await this.prisma.supportTicket.deleteMany({ where: { status: 'CLOSED', closedAt: { lt: new Date(Date.now() - KEEP_CLOSED_DAYS * DAY) } } });
    return count;
  }

  // ----------------------------------------------------------------------------------------- notifications

  /** The team learns that a ticket arrived: reference, category and subject only, the message stays in the admin. */
  private notifyTeam(t: SupportTicket) {
    const mail = renderActionMail({
      to: this.cfg.LEGAL_CONTACT_EMAIL,
      subject: `Casalume · Yeni destek talebi (${t.reference})`,
      heading: 'Yeni destek talebi',
      lines: [`Talep: ${t.reference}`, `Konu: ${t.subject}`, `Tür: ${t.category}`],
      cta: 'Panelde aç',
      url: `${this.cfg.ADMIN_APP_URL}/support?t=${t.id}`,
      footer: 'Casalume yönetim paneli bildirimi.',
    });
    void this.mailer.send(mail).catch((e: Error) => log.warn('support_team_mail_failed', { error: e.name }));
  }

  private notifyUser(t: SupportTicket & { user: { email: string | null; emailVerifiedAt: Date | null; locale: string; pushTokens: Array<{ token: string }> } }, reply: string) {
    const lang = contentLocale(t.user.locale);
    const c = COPY[lang];
    const path = `/destek?t=${t.id}`;
    const url = `${this.cfg.WEB_APP_URL}${t.user.locale === 'tr' ? '' : `/${t.user.locale}`}${path}`;
    if (t.user.email && t.user.emailVerifiedAt) {
      const quoted = reply.length > 1500 ? `${reply.slice(0, 1500)}…` : reply;
      const mail = renderActionMail({ to: t.user.email, subject: c.subject(t.reference), heading: c.heading, lines: [c.about(t.subject), quoted], cta: c.cta, url, footer: c.footer });
      void this.mailer.send(mail).catch((e: Error) => log.warn('support_reply_mail_failed', { error: e.name }));
    }
    if (t.user.pushTokens.length) {
      const messages: PushMessage[] = t.user.pushTokens.map(({ token }) => ({
        to: token, title: c.pushTitle, body: t.subject.slice(0, 120), sound: 'default', priority: 'high', channelId: 'designs',
        data: { type: 'support', ticketId: t.id, url: `casalume://support/${t.id}`, path },
      }));
      void this.push.send(messages).catch((e: Error) => log.warn('support_reply_push_failed', { error: e.name }));
    }
  }

  // ----------------------------------------------------------------------------------------------- shapes

  private summary(t: SupportTicket) {
    return {
      id: t.id, reference: t.reference, category: t.category, subject: t.subject, status: t.status, userUnread: t.userUnread,
      platform: t.platform, lastMessageAt: t.lastMessageAt.toISOString(), createdAt: t.createdAt.toISOString(), closedAt: t.closedAt?.toISOString() ?? null,
    };
  }

  private detail(t: TicketWithMessages) {
    return {
      ...this.summary(t), requestId: t.requestId, designId: t.designId, appVersion: t.appVersion, locale: t.locale,
      messages: t.messages.map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt.toISOString() })),
    };
  }
}
