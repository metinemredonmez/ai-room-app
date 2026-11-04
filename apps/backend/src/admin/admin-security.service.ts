import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Role, type User } from '../generated/prisma/client.js';
import { BACKUP_CODE_COUNT, hashBackupCode, newBackupCode, normalizeBackupCode, verifyTotp } from '../auth/crypto.js';
import { CONFIG, type Config } from '../config.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { MailerService, renderActionMail } from '../mail/mailer.service.js';
import { AuditService } from './audit.service.js';
import { isAdminRole } from './roles.js';

/** A promoted or MFA-reset admin must enroll a new authenticator within this window (AUT-04). */
export const ENROLL_WINDOW_MS = 72 * 60 * 60 * 1000;

/** PostgreSQL 40001 — surfaced as P2034 by the query engine, as a DriverAdapterError by @prisma/adapter-pg. */
function isSerializationFailure(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return e.code === 'P2034';
  const cause = (e as { cause?: { kind?: string; originalCode?: string } } | null)?.cause;
  return cause?.kind === 'TransactionWriteConflict' || cause?.originalCode === '40001';
}

const ROLE_TR: Record<Role, string> = { USER: 'Kullanıcı', SUPPORT: 'Destek', EDITOR: 'Editör', ADMIN: 'Yönetici', SUPER_ADMIN: 'Süper yönetici' };

/**
 * Admin MFA lifecycle and role changes (AUT-01, AUT-04, AZ-05). Every change is audited and the
 * affected admin gets an e-mail, so a silent takeover through support is visible to the owner.
 */
@Injectable()
export class AdminSecurityService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private mailer: MailerService,
    @Inject(CONFIG) private cfg: Config,
  ) {}

  private hash(normalized: string) {
    return hashBackupCode(this.cfg.DEVICE_PEPPER, normalized);
  }

  /** Replaces every recovery code; the plaintext is returned once and never stored. */
  async regenerateBackupCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, newBackupCode);
    await this.prisma.$transaction([
      this.prisma.adminBackupCode.deleteMany({ where: { userId } }),
      this.prisma.adminBackupCode.createMany({ data: codes.map((c) => ({ userId, codeHash: this.hash(normalizeBackupCode(c)!) })) }),
    ]);
    return codes;
  }

  remainingBackupCodes(userId: string) {
    return this.prisma.adminBackupCode.count({ where: { userId, usedAt: null } });
  }

  /** Atomic single use: two parallel logins with the same code can't both pass. Returns codes left, or null. */
  async consumeBackupCode(userId: string, input: string): Promise<number | null> {
    const normalized = normalizeBackupCode(input);
    if (!normalized) return null;
    const used = await this.prisma.adminBackupCode.updateMany({
      where: { userId, codeHash: this.hash(normalized), usedAt: null },
      data: { usedAt: new Date() },
    });
    return used.count === 1 ? this.remainingBackupCodes(userId) : null;
  }

  /** Verifies a TOTP code and claims its time step, so the same code can never be used twice. */
  async claimTotp(user: Pick<User, 'id' | 'totpSecret' | 'totpLastStep'>, otp: string): Promise<boolean> {
    const step = user.totpSecret ? verifyTotp(user.totpSecret, otp) : null;
    if (step === null) return false;
    const claimed = await this.prisma.user.updateMany({
      where: { id: user.id, totpSecret: user.totpSecret, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step) } }] },
      data: { totpLastStep: BigInt(step), lastSeenAt: new Date() },
    });
    return claimed.count === 1;
  }

  /** SUPER_ADMIN only (checked again inside the transaction). Serializable: two parallel demotions can't remove the last SUPER_ADMIN. */
  async changeRole(actorId: string, targetId: string, role: Role, reason: string, ip: string) {
    if (actorId === targetId) throw new AppError(400, 'bad_request', 'Kendi rolünüzü değiştiremezsiniz');
    const { before, after } = await this.superAdminTx(actorId, async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetId } });
      if (!target) throw notFound();
      if (target.role === role) return { before: target, after: target };
      if (isAdminRole(role) && (target.isGuest || !target.email || !target.emailVerifiedAt || !target.passwordHash || target.status !== 'ACTIVE')) {
        throw new AppError(400, 'bad_request', 'Yönetici yalnız e-postası doğrulanmış, aktif ve kayıtlı bir hesap olabilir');
      }
      if (target.role === 'SUPER_ADMIN') await this.ensureAnotherSuperAdmin(tx, targetId);
      const toUser = role === 'USER';
      const after = await tx.user.update({
        where: { id: targetId },
        data: {
          role,
          tokenVersion: { increment: 1 }, // SES-04: every existing session ends with the old role
          // Leaving the admin team drops its factors; joining it opens an enrollment window.
          ...(toUser ? { totpSecret: null, totpPendingSecret: null, totpLastStep: null, mfaEnrollBefore: null } : {}),
          ...(!toUser && !target.totpSecret ? { mfaEnrollBefore: new Date(Date.now() + ENROLL_WINDOW_MS) } : {}),
        },
      });
      if (toUser) await tx.adminBackupCode.deleteMany({ where: { userId: targetId } });
      await tx.refreshToken.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      return { before: target, after };
    });
    if (before.role === after.role) return after;
    await this.audit.record(actorId, 'admin.role_change', 'user', targetId, { from: before.role, to: after.role, reason }, ip);
    this.notify(after, 'Yönetici rolün değişti', [
      `Casalume yönetici rolün ${ROLE_TR[before.role]} → ${ROLE_TR[after.role]} olarak değiştirildi.`,
      `Gerekçe: ${reason}`,
      after.mfaEnrollBefore ? 'Panele ilk girişinde doğrulayıcı uygulamanı kaydetmen gerekiyor (72 saat içinde).' : 'Açık oturumların kapatıldı.',
    ]);
    return after;
  }

  /** SUPER_ADMIN only: clears TOTP and recovery codes, ends sessions, opens a 72 h enrollment window. */
  async resetMfa(actorId: string, targetId: string, reason: string, ip: string) {
    if (actorId === targetId) throw new AppError(400, 'bad_request', 'Kendi MFA ayarınızı buradan sıfırlayamazsınız');
    const target = await this.superAdminTx(actorId, async (tx) => {
      const t = await tx.user.findUnique({ where: { id: targetId } });
      if (!t || !isAdminRole(t.role)) throw notFound();
      await tx.adminBackupCode.deleteMany({ where: { userId: targetId } });
      await tx.refreshToken.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      return tx.user.update({
        where: { id: targetId },
        data: {
          totpSecret: null, totpPendingSecret: null, totpLastStep: null,
          mfaEnrollBefore: new Date(Date.now() + ENROLL_WINDOW_MS), tokenVersion: { increment: 1 },
        },
      });
    });
    await this.audit.record(actorId, 'admin.mfa_reset', 'user', targetId, { reason }, ip);
    this.notify(target, 'İki adımlı doğrulaman sıfırlandı', [
      'Bir süper yönetici, Casalume yönetim hesabının doğrulayıcı uygulamasını ve yedek kodlarını sıfırladı.',
      `Gerekçe: ${reason}`,
      'Açık oturumların kapatıldı. 72 saat içinde panele girip yeni doğrulayıcını kaydet.',
    ]);
    return target;
  }

  private async superAdminTx<T>(actorId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, status: true } });
          if (actor?.role !== 'SUPER_ADMIN' || actor.status !== 'ACTIVE') throw new AppError(403, 'forbidden', 'Bu işlem için yetkiniz yok');
          return fn(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      // Serialization failure: a parallel role change touched the same rows — the caller retries.
      if (isSerializationFailure(e)) throw new AppError(409, 'conflict', 'Aynı anda başka bir yetki değişikliği yapıldı, tekrar deneyin');
      throw e;
    }
  }

  private async ensureAnotherSuperAdmin(tx: Prisma.TransactionClient, excludeId: string) {
    const others = await tx.user.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE', id: { not: excludeId } } });
    if (others < 1) throw new AppError(409, 'conflict', 'Son SUPER_ADMIN düşürülemez');
  }

  /** Security notice to the affected admin; a mail failure never blocks the action (it is audited). */
  notify(user: Pick<User, 'email'>, subject: string, lines: string[]) {
    if (!user.email) return;
    void this.mailer
      .send(
        renderActionMail({
          to: user.email, subject: `Casalume · ${subject}`, heading: subject, lines,
          cta: 'Yönetim paneline git', url: this.cfg.ADMIN_APP_URL,
          footer: 'Bu işlemden haberin yoksa hemen bir süper yöneticiyle iletişime geç.',
        }),
      )
      .catch((e: Error) => log.error('admin_notice_failed', { error: e.name }));
  }
}
