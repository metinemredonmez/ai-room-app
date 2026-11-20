import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { commercialSignals, inQuietHours, nextSendableTime } from '../broadcasts/broadcast.rules.js';
import { BroadcastsService } from '../broadcasts/broadcasts.service.js';
import { QueuesService } from '../jobs/queues.service.js';
import { MailerService } from '../mail/mailer.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CONFIG, type Config } from '../config.js';
import { CampaignInputSchema, campaignMail, type CampaignInput } from './waitlist.rules.js';
import { WaitlistService } from './waitlist.service.js';

// Campaign mails to the waiting list (API.md §7.47): the launch note / newsletter the backlog asked for.
// Shares Toplu Gönderim's emailDailyCap and quiet hours (the list consented to the marketing text), paces one
// mail a second, skips anyone who leaves mid-send, and never mails the same entry twice (unique campaign+entry).

const BATCH = 50;
const DAY = 86_400_000;
type PauseReason = 'email_daily_cap' | 'quiet_hours';

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

@Injectable()
export class WaitlistCampaignsService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private queues: QueuesService,
    private settings: SettingsService,
    private broadcasts: BroadcastsService,
    private waitlist: WaitlistService,
    @Inject(CONFIG) private cfg: Config,
  ) {}

  list() {
    return this.prisma.waitlistCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { createdBy: { select: { name: true, email: true } } },
    });
  }

  /** Confirmed addresses = the reachable audience (also shown on the admin's compose dialog). */
  async estimate() {
    return { confirmed: await this.prisma.waitlistEntry.count({ where: { status: 'CONFIRMED' } }) };
  }

  async create(actorId: string, input: CampaignInput) {
    const parsed = CampaignInputSchema.parse(input);
    const commercial = commercialSignals({ title: parsed.subject, body: parsed.body }).length > 0;
    return this.prisma.waitlistCampaign.create({
      data: { ...parsed, commercial, createdById: actorId },
    });
  }

  /** DRAFT → SENDING and one queue job; quiet hours push the first attempt past the window. */
  async send(id: string) {
    const b = await this.get(id);
    if (b.status !== 'DRAFT') throw new AppError(409, 'conflict', 'Yalnız taslak bir kampanya gönderilebilir.');
    if (this.quietNow()) {
      await this.pause(id, 'quiet_hours');
    } else {
      await this.claim(id);
    }
    const targetCount = await this.prisma.waitlistEntry.count({ where: { status: 'CONFIRMED' } });
    await this.prisma.waitlistCampaign.update({ where: { id }, data: { targetCount } });
    await this.queues.waitlist.add('send', { campaignId: id }, { jobId: `waitlist-${id}` });
    return this.get(id);
  }

  async cancel(id: string) {
    const b = await this.get(id);
    if (!['DRAFT', 'SENDING', 'PAUSED'].includes(b.status)) throw new AppError(409, 'conflict', 'Bu kampanya iptal edilemez.');
    return this.prisma.waitlistCampaign.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: new Date() } });
  }

  /** Worker: round by round until the list is done, the day is full, or the night begins. paceMs=0 in tests. */
  async process(id: string, paceMs = 1000) {
    const b0 = await this.prisma.waitlistCampaign.findUnique({ where: { id } });
    if (!b0) return { gone: true as const };
    if (b0.status === 'CANCELLED') return { skipped: 'cancelled' as const };
    await this.claim(id);
    let cursor = '';
    for (;;) {
      const b = await this.prisma.waitlistCampaign.findUnique({ where: { id } });
      if (!b || b.status === 'CANCELLED') return { skipped: 'cancelled' as const };
      if (this.quietNow()) return this.pause(id, 'quiet_hours', paceMs);
      const batch = await this.prisma.waitlistEntry.findMany({
        where: { status: 'CONFIRMED', id: { gt: cursor }, sends: { none: { campaignId: id } } },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true },
      });
      if (!batch.length) {
        return this.prisma.waitlistCampaign.update({
          where: { id },
          data: { status: 'SENT', finishedAt: new Date(), error: null },
        });
      }
      let sent = 0;
      let failed = 0;
      for (const row of batch) {
        cursor = row.id;
        const cap = this.settings.current.broadcast.emailDailyCap;
        if (cap - (await this.broadcasts.emailSentToday()) <= 0) {
          await this.addCounts(id, sent, failed);
          return this.pause(id, 'email_daily_cap', paceMs);
        }
        const entry = await this.prisma.waitlistEntry.findUnique({ where: { id: row.id }, select: { status: true, email: true, locale: true } });
        if (!entry || entry.status !== 'CONFIRMED') continue; // left (or purged) mid-send: not counted
        try {
          await this.mailer.send(
            campaignMail({
              to: entry.email,
              locale: entry.locale,
              subject: b.subject,
              body: b.body,
              leaveUrl: this.waitlist.leaveUrl(row.id, entry.locale),
            }),
          );
          await this.prisma.waitlistCampaignSend.create({ data: { campaignId: id, entryId: row.id } });
          sent += 1;
        } catch (e) {
          failed += 1;
          log.warn('waitlist_campaign_mail_failed', { campaignId: id, error: (e as Error).name });
        }
        await sleep(paceMs);
      }
      await this.addCounts(id, sent, failed);
    }
  }

  private async get(id: string) {
    const b = await this.prisma.waitlistCampaign.findUnique({ where: { id } });
    if (!b) throw new AppError(404, 'not_found', 'Kampanya bulunamadı');
    return b;
  }

  private quietNow() {
    const s = this.settings.current.broadcast;
    return inQuietHours(new Date(), s.quietStart, s.quietEnd);
  }

  /** SENDING/PAUSED → SENDING; startedAt set once. */
  private async claim(id: string) {
    await this.prisma.waitlistCampaign.updateMany({
      where: { id, status: { in: ['DRAFT', 'SENDING', 'PAUSED'] } },
      data: { status: 'SENDING', startedAt: new Date(), error: null },
    });
  }

  private async addCounts(id: string, sent: number, failed: number) {
    await this.prisma.waitlistCampaign.update({
      where: { id },
      data: { sentCount: { increment: sent }, failedCount: { increment: failed } },
    });
  }

  /** PAUSED with a delayed resume at the next sendable moment (quiet end, cap reset — whichever is later). */
  private async pause(id: string, reason: PauseReason, _paceMs = 1000) {
    const s = this.settings.current.broadcast;
    const quietEnd = nextSendableTime(new Date(), s.quietStart, s.quietEnd);
    const midnight = new Date(`${todayInIstanbul()}T00:00:00+03:00`);
    const capReset = new Date(midnight.getTime() + DAY);
    const at = reason === 'email_daily_cap' ? new Date(Math.max(quietEnd.getTime(), capReset.getTime())) : quietEnd;
    await this.prisma.waitlistCampaign.updateMany({
      where: { id, status: { in: ['SENDING', 'PAUSED'] } },
      data: { status: 'PAUSED', error: reason },
    });
    await this.queues.waitlist.add('send', { campaignId: id }, { jobId: `waitlist-${id}-resume-${at.getTime()}`, delay: Math.max(0, at.getTime() - Date.now()) });
    return { paused: reason };
  }
}
