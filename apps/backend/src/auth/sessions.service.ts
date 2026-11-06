import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import type { ClientInfo } from './client-info.js';

// Active sessions and sign-in history (API.md §7.37; YediOda #5–6). A session is a refresh-token family; it is
// "active" while it is not closed and was used within the refresh lifetime. Sign-in attempts on existing accounts are
// kept 90 days (retention job); attempts on unknown addresses are not stored at all.

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export type LoginMethod = 'password' | 'register' | 'guest' | 'google' | 'apple' | 'admin' | 'review';
export type LoginReason = 'bad_password' | 'bad_second_factor' | 'suspended';

@Injectable()
export class SessionsService {
  constructor(private prisma: PrismaService) {}

  /** Fire-and-forget: a history write never fails a sign-in. */
  recordLogin(userId: string, ok: boolean, method: LoginMethod, client: ClientInfo, reason: LoginReason | null = null) {
    void this.prisma.loginEvent
      .create({ data: { userId, ok, method, reason, device: client.device, ipPrefix: client.ipPrefix } })
      .catch((e: Error) => log.warn('login_event_failed', { error: e.name }));
  }

  async active(userId: string, currentId: string | null) {
    const rows = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, lastUsedAt: { gte: new Date(Date.now() - REFRESH_TTL_MS) } },
      orderBy: { lastUsedAt: 'desc' },
      take: 50,
    });
    return rows.map((s) => ({
      id: s.id,
      device: s.device,
      ipPrefix: s.ipPrefix,
      method: s.method,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentId,
    }));
  }

  async logins(userId: string, take = 20) {
    const rows = await this.prisma.loginEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take });
    return rows.map((e) => ({ ok: e.ok, method: e.method, reason: e.reason, device: e.device, ipPrefix: e.ipPrefix, createdAt: e.createdAt.toISOString() }));
  }
}
