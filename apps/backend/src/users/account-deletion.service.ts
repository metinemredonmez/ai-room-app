import { Injectable } from '@nestjs/common';
import { OAuthService } from '../auth/oauth.service.js';
import { log } from '../common/log.js';
import { PrismaService } from '../common/infra.js';
import { AuditService } from '../admin/audit.service.js';
import { ImagesService } from '../images/images.service.js';
import type { User } from '../generated/prisma/client.js';

// Account deletion with a 30-day undo window (YediOda #18). Asking to delete schedules the erase:
// sessions die at once (tokenVersion), the data stays until the deadline, and signing back in within
// the window cancels everything. The retention job erases what the deadline passed; that erase is the
// same App Store 5.1.1(v) flow as before (Apple tokens revoked by a retrying job, images removed after
// the row is gone, never the other way around).

const DAY = 86_400_000;
export const GRACE_DAYS = 30;

@Injectable()
export class AccountDeletionService {
  constructor(
    private prisma: PrismaService,
    private oauth: OAuthService,
    private images: ImagesService,
    private audit: AuditService,
  ) {}

  async schedule(userId: string, ip: string | null) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'PENDING_DELETION',
        deletionScheduledAt: new Date(Date.now() + GRACE_DAYS * DAY),
        tokenVersion: { increment: 1 }, // every session stops at once (SES-04)
      },
    });
    await this.audit.record(userId, 'account.deletion_scheduled', 'user', userId, { graceDays: GRACE_DAYS }, ip ?? undefined);
    log.info('account_deletion_scheduled', { userId, graceDays: GRACE_DAYS });
  }

  /** Sign-in during the window cancels the deletion. 'purged' = the deadline already passed and the erase ran. */
  async reactivateIfPending(user: User): Promise<User | 'purged'> {
    if (user.status !== 'PENDING_DELETION') return user;
    if (!user.deletionScheduledAt || user.deletionScheduledAt.getTime() <= Date.now()) {
      await this.purge(user.id);
      return 'purged';
    }
    const restored = await this.prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', deletionScheduledAt: null },
    });
    await this.audit.record(user.id, 'account.deletion_cancelled', 'user', user.id, {}, undefined);
    log.info('account_deletion_cancelled', { userId: user.id });
    return restored;
  }

  /** The actual erase. Apple tokens are revoked first by a retrying job, so Apple being down never blocks it. */
  async purge(userId: string) {
    const appleRevokes = await this.oauth.scheduleAccountRevocations(userId);
    const imgs = await this.prisma.image.findMany({ where: { ownerId: userId }, select: { id: true } });
    await this.prisma.user.delete({ where: { id: userId } });
    await this.images.remove(imgs.map((i) => i.id));
    log.info('account_deleted', { userId, images: imgs.length, appleRevokes });
    return { images: imgs.length, appleRevokes };
  }

  /** Retention: erase accounts whose window closed. */
  async purgeDue(now = new Date()) {
    const due = await this.prisma.user.findMany({
      where: { status: 'PENDING_DELETION', deletionScheduledAt: { lte: now } },
      select: { id: true },
      take: 500,
    });
    for (const u of due) await this.purge(u.id);
    return due.length;
  }
}
