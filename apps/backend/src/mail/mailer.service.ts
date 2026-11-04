import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';
import { CONFIG, type Config } from '../config.js';
import { log } from '../common/log.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, e.g. List-Unsubscribe for marketing mail (RFC 8058). */
  headers?: Record<string, string>;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Casalume brand (Kil palette); every value interpolated into the HTML must already be escaped. */
export const mailButton = (url: string, label: string) =>
  `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:8px;background:#A9532E;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${escapeHtml(label)}</a>`;

export function mailShell(o: { heading: string; bodyHtml: string; footerHtml: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#F6F1EA;font-family:Helvetica,Arial,sans-serif;color:#1C1714">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;margin-bottom:24px">Casa<span style="color:#A9532E">lume</span></div>
    <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #E7DDD1">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:22px;margin:0 0 12px">${escapeHtml(o.heading)}</h1>
      ${o.bodyHtml}
    </div>
    <p style="font-size:12px;line-height:1.5;color:#6E655E;margin-top:20px">${o.footerHtml}</p>
  </div></body></html>`;
}

/** A small branded HTML e-mail with one call-to-action button and a plain-text twin. */
export function renderActionMail(o: { to: string; subject: string; heading: string; lines: string[]; cta: string; url: string; footer: string }): Mail {
  const text = [o.heading, '', ...o.lines, '', `${o.cta}: ${o.url}`, '', o.footer].join('\n');
  const html = mailShell({
    heading: o.heading,
    bodyHtml: o.lines.map((l) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${escapeHtml(l)}</p>`).join('') + mailButton(o.url, o.cta),
    footerHtml: escapeHtml(o.footer),
  });
  return { to: o.to, subject: o.subject, text, html };
}

/**
 * Development: mails are written to DATA_DIR/outbox/*.json (git-ignored) instead of being sent.
 * Production: SMTP (config refuses to boot without it). Message bodies never reach the log (LOG-02).
 */
@Injectable()
export class MailerService {
  private transport: Transporter | null = null;
  private outbox: string;

  constructor(@Inject(CONFIG) private cfg: Config) {
    this.outbox = path.resolve(cfg.DATA_DIR, 'outbox');
    if (cfg.MAIL_TRANSPORT === 'smtp' && cfg.SMTP_URL) this.transport = createTransport(cfg.SMTP_URL);
  }

  async send(mail: Mail): Promise<void> {
    if (this.transport) {
      await this.transport.sendMail({ from: this.cfg.MAIL_FROM, ...mail });
    } else {
      await mkdir(this.outbox, { recursive: true, mode: 0o700 });
      const file = path.join(this.outbox, `${Date.now()}-${randomUUID()}.json`);
      await writeFile(file, JSON.stringify({ from: this.cfg.MAIL_FROM, ...mail, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    }
    log.info('mail_sent', { transport: this.transport ? 'smtp' : 'outbox', subject: mail.subject });
  }
}
