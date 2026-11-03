import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { LEGAL_VERSIONS, CONSENT_KINDS, type ConsentKind } from './legal.js';

/** Append-only consent log (patterns from palemi consents + yoga KVKK): the latest row per kind wins. */
@Injectable()
export class ConsentsService {
  constructor(private prisma: PrismaService) {}

  async record(userId: string, kind: ConsentKind, version: string, granted: boolean, ip?: string) {
    if (version !== LEGAL_VERSIONS[kind]) {
      throw new AppError(409, 'conflict', `Güncel metin sürümü ${LEGAL_VERSIONS[kind]}; sayfayı yenileyip tekrar onaylayın`);
    }
    const row = await this.prisma.consent.create({ data: { userId, kind, version, granted, ip: ip ?? null } });
    return { kind: row.kind, version: row.version, granted: row.granted, createdAt: row.createdAt.toISOString() };
  }

  async list(userId: string) {
    const rows = await this.prisma.consent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 });
    const current = Object.fromEntries(
      CONSENT_KINDS.map((k) => {
        const latest = rows.find((r) => r.kind === k);
        return [k, { required: LEGAL_VERSIONS[k], version: latest?.version ?? null, granted: Boolean(latest?.granted && latest.version === LEGAL_VERSIONS[k]) }];
      }),
    );
    return {
      items: rows.map((r) => ({ kind: r.kind, version: r.version, granted: r.granted, createdAt: r.createdAt.toISOString() })),
      current,
    };
  }

  /** True when the latest decision for `kind` is a grant of the current version. */
  async hasCurrent(userId: string, kind: ConsentKind): Promise<boolean> {
    const latest = await this.prisma.consent.findFirst({ where: { userId, kind }, orderBy: { createdAt: 'desc' } });
    return Boolean(latest?.granted && latest.version === LEGAL_VERSIONS[kind]);
  }
}
