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
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A small branded HTML e-mail with one call-to-action button and a plain-text twin. */
export function renderActionMail(o: { to: string; subject: string; heading: string; lines: string[]; cta: string; url: string; footer: string }): Mail {
  const text = [o.heading, '', ...o.lines, '', `${o.cta}: ${o.url}`, '', o.footer].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#F7F4EF;font-family:Helvetica,Arial,sans-serif;color:#141414">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-weight:800;font-size:20px;margin-bottom:24px">AI <span style="color:#1F6F5C">Room</span></div>
    <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #E6E1D8">
      <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(o.heading)}</h1>
      ${o.lines.map((l) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${escapeHtml(l)}</p>`).join('')}
      <a href="${escapeHtml(o.url)}" style="display:inline-block;margin-top:8px;background:#1F6F5C;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">${escapeHtml(o.cta)}</a>
    </div>
    <p style="font-size:12px;color:#6B6A66;margin-top:20px">${escapeHtml(o.footer)}</p>
  </div></body></html>`;
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
