import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import type { Prisma } from '../generated/prisma/client.js';

/** LOG-01: privileged actions are stored with actor, target, decision context and peer IP. */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async record(
    actorId: string | null,
    action: string,
    targetType: string,
    targetId: string | null,
    meta: Record<string, unknown> = {},
    ip?: string,
  ) {
    log.info('audit', { actorId, action, targetType, targetId, ip });
    await this.prisma.auditLog.create({
      data: { actorId, action, targetType, targetId, meta: meta as Prisma.InputJsonValue, ip: ip ?? null },
    });
  }
}
