import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { CONFIG, type Config } from '../config.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import type { DataRequest, DataRequestStatus, Prisma, User } from '../generated/prisma/client.js';
import { MailerService, renderActionMail } from '../mail/mailer.service.js';

// KVKK m.11 rights, a–ğ, plus "other".
export const DATA_REQUEST_TYPES = ['info', 'access', 'transfers', 'rectification', 'erasure', 'third_party_notice', 'objection', 'compensation', 'other'] as const;
export type DataRequestType = (typeof DATA_REQUEST_TYPES)[number];
export const DATA_REQUEST_CHANNELS = ['app', 'email', 'kep', 'letter', 'other'] as const;
export type DataRequestChannel = (typeof DATA_REQUEST_CHANNELS)[number];

/** KVKK m.13/2: an application is answered within 30 days at the latest. */
export const RESPONSE_DAYS = 30;
export const MAX_OPEN_PER_USER = 3;
const DAY = 86_400_000;
const OPEN: DataRequestStatus[] = ['RECEIVED', 'IN_PROGRESS'];
const NEXT: Record<DataRequestStatus, DataRequestStatus[]> = {
  RECEIVED: ['IN_PROGRESS', 'COMPLETED', 'REJECTED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
};

const TYPE_TR: Record<DataRequestType, string> = {
  info: 'Verilerimin işlenip işlenmediğini öğrenme', access: 'Verilerim hakkında bilgi talebi', transfers: 'Aktarılan üçüncü kişileri öğrenme',
  rectification: 'Düzeltme', erasure: 'Silme / yok etme', third_party_notice: 'Üçüncü kişilere bildirim', objection: 'Otomatik analize itiraz',
  compensation: 'Zararın giderilmesi', other: 'Diğer',
};

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const newReference = (now: Date) => `KVKK-${now.getUTCFullYear()}-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;

export const dueFrom = (receivedAt: Date) => new Date(receivedAt.getTime() + RESPONSE_DAYS * DAY);

/** Whole days left until the deadline (negative once overdue). */
export const daysLeft = (dueAt: Date, now = Date.now()) => Math.ceil((dueAt.getTime() - now) / DAY);

/**
 * KVKK m.11 applications and their 30-day deadline (m.13). Requests from the app are verified by the
 * session; ones received by e-mail, KEP or letter are logged by an admin with the date they arrived.
 * Details and answers are personal data: they never reach logs, audit metadata or e-mail subjects.
 */
@Injectable()
export class DataRequestsService {
  constructor(private prisma: PrismaService, private mailer: MailerService, @Inject(CONFIG) private cfg: Config) {}

  async create(user: User, type: DataRequestType, details: string) {
    const open = await this.prisma.dataRequest.count({ where: { userId: user.id, status: { in: OPEN } } });
    if (open >= MAX_OPEN_PER_USER) {
      throw new AppError(409, 'too_many_open_requests', `Aynı anda en çok ${MAX_OPEN_PER_USER} açık başvurun olabilir; mevcut başvuruların sonuçlanınca yenisini açabilirsin`);
    }
    const row = await this.insert({ userId: user.id, type, details, channel: 'app', contactEmail: null, receivedAt: new Date() });
    log.info('kvkk_request_created', { reference: row.reference, type, channel: 'app' });
    if (user.email) {
      this.mail(user.email, `Casalume · KVKK başvurun alındı (${row.reference})`, 'KVKK başvurun alındı', [
        `Başvuru numaran: ${row.reference}`,
        `Konu: ${TYPE_TR[type]}`,
        `Başvurun en geç ${fmt(row.dueAt)} tarihine kadar sonuçlandırılacak. Durumunu uygulamada Profil → Gizlilik ekranından izleyebilirsin.`,
      ]);
    }
    this.notifyController(row);
    return this.toUserDto(row);
  }

  async listMine(userId: string) {
    const rows = await this.prisma.dataRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { items: rows.map((r) => this.toUserDto(r)) };
  }

  /** Applications received outside the app; the deadline runs from the day they arrived. */
  async createManual(input: { type: DataRequestType; channel: Exclude<DataRequestChannel, 'app'>; contactEmail: string | null; details: string; receivedAt: Date; userId: string | null }) {
    if (input.receivedAt.getTime() > Date.now() + 60_000) throw new AppError(400, 'validation_failed', 'Başvuru tarihi gelecekte olamaz');
    if (input.userId && !(await this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } }))) throw notFound();
    const row = await this.insert(input);
    log.info('kvkk_request_created', { reference: row.reference, type: input.type, channel: input.channel });
    return this.toAdminDto(row);
  }

  async adminList(q: { status?: DataRequestStatus; overdue?: boolean; cursor?: string; limit: number }) {
    const now = new Date();
    const where: Prisma.DataRequestWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.overdue ? { status: { in: OPEN }, dueAt: { lt: now } } : {}),
    };
    const [rows, open, dueSoon, overdue] = await Promise.all([
      this.prisma.dataRequest.findMany({
        where, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      this.prisma.dataRequest.count({ where: { status: { in: OPEN } } }),
      this.prisma.dataRequest.count({ where: { status: { in: OPEN }, dueAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY) } } }),
      this.prisma.dataRequest.count({ where: { status: { in: OPEN }, dueAt: { lt: now } } }),
    ]);
    const page = rows.slice(0, q.limit);
    return { counts: { open, dueSoon, overdue }, items: page.map((r) => this.toAdminDto(r)), nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null };
  }

  async adminGet(id: string) {
    const row = await this.prisma.dataRequest.findUnique({ where: { id }, include: { user: true } });
    if (!row) throw notFound();
    const u = row.user;
    return {
      ...this.toAdminDto(row),
      user: u ? { id: u.id, email: u.email, name: u.name, isGuest: u.isGuest, status: u.status, createdAt: u.createdAt.toISOString() } : null,
    };
  }

  /** Status changes; closing needs the answer, which is shown in the app and e-mailed to the applicant. */
  async update(id: string, actorId: string, input: { status: DataRequestStatus; response?: string }) {
    const row = await this.prisma.dataRequest.findUnique({ where: { id }, include: { user: { select: { email: true } } } });
    if (!row) throw notFound();
    if (!NEXT[row.status].includes(input.status)) throw new AppError(409, 'conflict', `Başvuru ${row.status} durumundan ${input.status} durumuna geçemez`);
    const closing = input.status === 'COMPLETED' || input.status === 'REJECTED';
    if (closing && !input.response) throw new AppError(400, 'validation_failed', 'Sonuçlandırmak için başvuru sahibine verilecek yanıt gerekli');
    // Conditional on the old status: two admins closing at once can't both send an answer.
    const changed = await this.prisma.dataRequest.updateMany({
      where: { id, status: row.status },
      data: { status: input.status, handledBy: actorId, ...(input.response ? { response: input.response } : {}), ...(closing ? { closedAt: new Date() } : {}) },
    });
    if (!changed.count) throw new AppError(409, 'conflict', 'Başvuru bu sırada güncellendi; sayfayı yenileyin');
    const updated = await this.prisma.dataRequest.findUniqueOrThrow({ where: { id } });
    const to = row.user?.email ?? row.contactEmail;
    if (closing && to) {
      this.mail(to, `Casalume · KVKK başvurun sonuçlandı (${row.reference})`, 'KVKK başvurun sonuçlandı', [
        `Başvuru numaran: ${row.reference}`,
        `Sonuç: ${input.status === 'COMPLETED' ? 'Tamamlandı' : 'Reddedildi'}`,
        input.response!,
        'Yanıtı yeterli bulmazsan, yanıtı aldığın tarihten itibaren 30 gün ve her hâlde başvuru tarihinden itibaren 60 gün içinde Kişisel Verileri Koruma Kurulu’na şikâyette bulunabilirsin (KVKK m.14).',
      ]);
    }
    log.info('kvkk_request_updated', { reference: row.reference, status: input.status });
    return this.toAdminDto(updated);
  }

  /** Daily: open applications due within 7 days or overdue go to the privacy contact and the admin team. */
  async deadlineDigest() {
    const now = Date.now();
    const rows = await this.prisma.dataRequest.findMany({
      where: { status: { in: OPEN }, dueAt: { lt: new Date(now + 7 * DAY) } },
      orderBy: { dueAt: 'asc' }, take: 100,
    });
    if (!rows.length) return { dueSoon: 0, overdue: 0, notified: 0 };
    const overdue = rows.filter((r) => r.dueAt.getTime() < now).length;
    const admins = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', email: { not: null } }, select: { email: true },
    });
    const recipients = [...new Set([this.cfg.LEGAL_CONTACT_EMAIL, ...admins.map((a) => a.email!)])];
    const lines = rows.map((r) => {
      const d = daysLeft(r.dueAt, now);
      return `${r.reference} · ${TYPE_TR[r.type as DataRequestType] ?? r.type} · son gün ${fmt(r.dueAt)} (${d < 0 ? `${-d} gün gecikti` : `${d} gün kaldı`})`;
    });
    for (const to of recipients) {
      this.mail(to, `Casalume · KVKK başvuru süreleri: ${overdue} gecikmiş, ${rows.length - overdue} yaklaşan`, 'KVKK başvuru süreleri', lines, this.cfg.ADMIN_APP_URL, 'Yönetim paneline git');
    }
    log.warn('kvkk_deadlines', { dueSoon: rows.length - overdue, overdue, notified: recipients.length });
    return { dueSoon: rows.length - overdue, overdue, notified: recipients.length };
  }

  /** Closed applications are kept 2 years as proof of handling, then deleted. */
  async purgeClosed() {
    const res = await this.prisma.dataRequest.deleteMany({ where: { status: { notIn: OPEN }, closedAt: { lt: new Date(Date.now() - 730 * DAY) } } });
    return res.count;
  }

  private async insert(data: { userId: string | null; type: DataRequestType; details: string; channel: DataRequestChannel; contactEmail: string | null; receivedAt: Date }) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.dataRequest.create({ data: { ...data, reference: newReference(data.receivedAt), dueAt: dueFrom(data.receivedAt) } });
      } catch (e) {
        const unique = (e as { code?: string }).code === 'P2002' || (e as { cause?: { kind?: string } }).cause?.kind === 'UniqueConstraintViolation';
        if (!unique || attempt >= 2) throw e;
      }
    }
  }

  /** The privacy contact learns that an application arrived — reference and deadline only. */
  private notifyController(row: DataRequest) {
    this.mail(this.cfg.LEGAL_CONTACT_EMAIL, `Casalume · Yeni KVKK başvurusu (${row.reference})`, 'Yeni KVKK başvurusu', [
      `Başvuru numarası: ${row.reference}`,
      `Konu: ${TYPE_TR[row.type as DataRequestType] ?? row.type}`,
      `Son yanıt tarihi: ${fmt(row.dueAt)}`,
    ], this.cfg.ADMIN_APP_URL, 'Yönetim paneline git');
  }

  private mail(to: string, subject: string, heading: string, lines: string[], url = this.cfg.WEB_APP_URL, cta = 'Casalume') {
    void this.mailer
      .send(renderActionMail({ to, subject, heading, lines, cta, url, footer: 'Bu e-posta KVKK başvurunla ilgili olarak gönderildi.' }))
      .catch((e: Error) => log.error('kvkk_mail_failed', { error: e.name }));
  }

  toUserDto(r: DataRequest) {
    return {
      id: r.id, reference: r.reference, type: r.type, status: r.status, details: r.details, response: r.response,
      receivedAt: r.receivedAt.toISOString(), dueAt: r.dueAt.toISOString(), closedAt: r.closedAt?.toISOString() ?? null,
    };
  }

  toAdminDto(r: DataRequest) {
    const open = OPEN.includes(r.status);
    return {
      ...this.toUserDto(r), channel: r.channel, contactEmail: r.contactEmail, userId: r.userId, handledBy: r.handledBy,
      daysLeft: open ? daysLeft(r.dueAt) : null, overdue: open && r.dueAt.getTime() < Date.now(),
    };
  }
}

const fmt = (d: Date) => d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: 'long', year: 'numeric' });
