import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { atLeast, isAdminRole, type AdminRole } from '../admin/roles.js';
import { contentLocale } from '../catalog/catalog.data.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { CONFIG, type Config } from '../config.js';
import { isUuid } from '../images/images.service.js';
import { MailerService, renderActionMail } from '../mail/mailer.service.js';
import { PushService, type PushMessage } from '../push/push.service.js';

// Gift credits from the panel (API.md §7.31; YediOda #63 "manuel hediye"). Unlike a staff adjustment (`admin: …`,
// shown to the user only as "adjustment"), a gift is meant to be seen: the user gets a push, optionally an e-mail with
// the staff's short message, and the movement reads "Gift". The internal reason stays in the audit log only.

export const GiftSchema = z
  .object({
    credits: z.number().int().min(1).max(500),
    /** Shown to the user in the push and e-mail. */
    message: z.string().trim().max(140).default(''),
    email: z.boolean().default(false),
    /** For the audit log only. */
    reason: z.string().trim().min(3).max(200),
  })
  .strict();
export type GiftInput = z.infer<typeof GiftSchema>;

const COPY = {
  tr: {
    pushTitle: (n: number) => `Hediye: ${n} kredi`,
    pushBody: 'Casalume ekibinden sana hediye kredi. Hemen yeni bir tasarım dene.',
    subject: (n: number) => `Casalume · ${n} kredi hediye`,
    heading: 'Sana hediye kredi gönderdik',
    line: (n: number) => `${n} kredi hesabına eklendi.`,
    cta: 'Tasarıma başla',
    footer: 'Bu e-postayı Casalume hesabına hediye kredi eklendiği için aldın.',
  },
  en: {
    pushTitle: (n: number) => `Gift: ${n} credits`,
    pushBody: 'A gift from the Casalume team. Try a new design now.',
    subject: (n: number) => `Casalume · ${n} credits for you`,
    heading: 'We sent you gift credits',
    line: (n: number) => `${n} credits were added to your account.`,
    cta: 'Start designing',
    footer: 'You received this e-mail because gift credits were added to your Casalume account.',
  },
};

@Injectable()
export class GiftService {
  constructor(private prisma: PrismaService, private push: PushService, private mailer: MailerService, @Inject(CONFIG) private cfg: Config) {}

  async give(userId: string, input: GiftInput, actor: { id: string; role: AdminRole }) {
    if (!isUuid(userId)) throw notFound();
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId }, include: { pushTokens: { select: { token: true } } } });
      if (!u) throw notFound();
      // Same rule as credit adjustments: staff accounts are changed by SUPER_ADMIN only (AZ-05).
      if (isAdminRole(u.role) && !atLeast(actor.role, 'SUPER_ADMIN')) throw new AppError(403, 'forbidden', 'Yönetici hesaplarına yalnız SUPER_ADMIN hediye verebilir');
      if (u.status !== 'ACTIVE') throw new AppError(409, 'conflict', 'Askıdaki hesaba hediye verilemez');
      await tx.user.update({ where: { id: userId }, data: { credits: { increment: input.credits } } });
      await tx.creditLedger.create({ data: { userId, delta: input.credits, reason: 'gift', refId: actor.id } });
      return u;
    });

    const c = COPY[contentLocale(user.locale)];
    const path = '/hesap';
    let pushed = 0;
    if (user.pushTokens.length) {
      const messages: PushMessage[] = user.pushTokens.map(({ token }) => ({
        to: token, title: c.pushTitle(input.credits), body: input.message || c.pushBody, sound: 'default', priority: 'high', channelId: 'designs',
        data: { type: 'gift', path },
      }));
      pushed = messages.length;
      void this.push.send(messages).catch((e: Error) => log.warn('gift_push_failed', { error: e.name }));
    }
    const emailed = Boolean(input.email && user.email && user.emailVerifiedAt);
    if (emailed) {
      const url = `${this.cfg.WEB_APP_URL}${user.locale === 'tr' ? '' : `/${user.locale}`}/studio`;
      const lines = [c.line(input.credits), ...(input.message ? [input.message] : [])];
      const mail = renderActionMail({ to: user.email!, subject: c.subject(input.credits), heading: c.heading, lines, cta: c.cta, url, footer: c.footer });
      void this.mailer.send(mail).catch((e: Error) => log.warn('gift_mail_failed', { error: e.name }));
    }
    log.info('gift_given', { userId, credits: input.credits, pushed, emailed });
    return { credits: user.credits + input.credits, pushed, emailed };
  }
}
