import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import type { EmailTokenPurpose, User } from '../generated/prisma/client.js';
import { renderActionMail, MailerService } from '../mail/mailer.service.js';
import { randomToken, sha256 } from './crypto.js';

const TTL_MS: Record<EmailTokenPurpose, number> = {
  RESET_PASSWORD: 30 * 60 * 1000,
  VERIFY_EMAIL: 48 * 60 * 60 * 1000,
};

const PATHS: Record<EmailTokenPurpose, string> = {
  RESET_PASSWORD: '/sifre-sifirla',
  VERIFY_EMAIL: '/eposta-dogrula',
};

export const invalidToken = () => new AppError(400, 'invalid_token', 'Bağlantı geçersiz veya süresi dolmuş');

/**
 * AUT-03 / MAIL-01: tokens are bound to user + purpose + e-mail address, stored as SHA-256, consumed
 * exactly once, and every link is built from the configured WEB_APP_URL. The token travels in the URL
 * fragment, so it never reaches server logs, proxies or Referer headers.
 */
@Injectable()
export class EmailTokensService {
  constructor(private prisma: PrismaService, private mailer: MailerService, @Inject(CONFIG) private cfg: Config) {}

  link(purpose: EmailTokenPurpose, token: string): string {
    const url = new URL(PATHS[purpose], this.cfg.WEB_APP_URL);
    url.hash = `token=${token}`;
    return url.toString();
  }

  /** Issues a fresh token; any older unused token for the same purpose stops working. */
  async issue(user: Pick<User, 'id' | 'email'>, purpose: EmailTokenPurpose): Promise<string> {
    if (!user.email) throw new AppError(400, 'bad_request', 'Hesapta e-posta yok');
    const token = randomToken(32);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.emailToken.updateMany({ where: { userId: user.id, purpose, usedAt: null }, data: { usedAt: now } }),
      this.prisma.emailToken.create({
        data: { userId: user.id, purpose, email: user.email, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + TTL_MS[purpose]) },
      }),
    ]);
    return token;
  }

  /** Atomically claims the token (parallel requests: only one wins), then checks it still fits the account. */
  async consume(token: string, purpose: EmailTokenPurpose): Promise<User> {
    const tokenHash = sha256(token);
    const claimed = await this.prisma.emailToken.updateMany({
      where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalidToken();
    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!row || row.user.email !== row.email || row.user.status !== 'ACTIVE') throw invalidToken();
    return row.user;
  }

  async sendVerification(user: Pick<User, 'id' | 'email' | 'locale'>) {
    const token = await this.issue(user, 'VERIFY_EMAIL');
    const en = user.locale === 'en';
    await this.mailer.send(
      renderActionMail({
        to: user.email!,
        subject: en ? 'Confirm your e-mail — AI Room' : 'E-posta adresini doğrula — AI Room',
        heading: en ? 'Confirm your e-mail address' : 'E-posta adresini doğrula',
        lines: en
          ? ['Thanks for joining AI Room. Confirm this address to secure your account and recover it if you ever forget your password.']
          : ["AI Room'a hoş geldin. Hesabını güvene almak ve şifreni unutursan kurtarabilmek için bu adresi doğrula."],
        cta: en ? 'Confirm e-mail' : 'E-postamı doğrula',
        url: this.link('VERIFY_EMAIL', token),
        footer: en ? 'The link is valid for 48 hours. If you did not sign up, ignore this e-mail.' : 'Bağlantı 48 saat geçerlidir. Kayıt olmadıysan bu e-postayı yok sayabilirsin.',
      }),
    );
  }

  async sendPasswordReset(user: Pick<User, 'id' | 'email' | 'locale'>) {
    const token = await this.issue(user, 'RESET_PASSWORD');
    const en = user.locale === 'en';
    await this.mailer.send(
      renderActionMail({
        to: user.email!,
        subject: en ? 'Reset your password — AI Room' : 'Şifre sıfırlama — AI Room',
        heading: en ? 'Reset your password' : 'Şifreni sıfırla',
        lines: en
          ? ['We received a request to reset the password of your AI Room account.', 'After the reset you will be signed out on every device.']
          : ['AI Room hesabın için şifre sıfırlama isteği aldık.', 'Şifreni değiştirdiğinde tüm cihazlardaki oturumların kapatılır.'],
        cta: en ? 'Choose a new password' : 'Yeni şifre belirle',
        url: this.link('RESET_PASSWORD', token),
        footer: en ? 'The link is valid for 30 minutes and works once. If you did not ask for this, ignore this e-mail.' : 'Bağlantı 30 dakika geçerlidir ve tek kullanımlıktır. Bu isteği sen yapmadıysan e-postayı yok sayabilirsin.',
      }),
    );
  }
}
