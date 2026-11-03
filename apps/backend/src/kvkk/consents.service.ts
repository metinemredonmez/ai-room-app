import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { CONSENT_KINDS, type ConsentKind } from './legal.js';
import { LegalService } from './legal.service.js';

/** Append-only consent log (patterns from palemi consents + yoga KVKK): the latest row per kind wins. */
@Injectable()
export class ConsentsService {
  constructor(private prisma: PrismaService, private legal: LegalService) {}

  async record(userId: string, kind: ConsentKind, version: string, granted: boolean, ip?: string) {
    const current = this.legal.versionOf(kind).version;
    // A grant must name the text the user saw; a withdrawal is always honoured (KVKK: consent can be withdrawn any time).
    if (granted && version !== current) {
      throw new AppError(409, 'conflict', `Güncel metin sürümü ${current}; sayfayı yenileyip tekrar onaylayın`);
    }
    const row = await this.prisma.consent.create({ data: { userId, kind, version: granted ? version : current, granted, ip: ip ?? null } });
    return { kind: row.kind, version: row.version, granted: row.granted, createdAt: row.createdAt.toISOString() };
  }

  async list(userId: string) {
    const rows = await this.prisma.consent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 });
    const current = Object.fromEntries(
      CONSENT_KINDS.map((k) => {
        const latest = rows.find((r) => r.kind === k);
        const v = this.legal.versionOf(k);
        return [k, { current: v.version, required: v.consentVersion, version: latest?.version ?? null, granted: Boolean(latest?.granted && this.legal.acceptanceValid(k, latest.version)) }];
      }),
    );
    return {
      items: rows.map((r) => ({ kind: r.kind, version: r.version, granted: r.granted, createdAt: r.createdAt.toISOString() })),
      current,
    };
  }

  /** True when the latest decision for `kind` is a grant that is still valid for the published texts. */
  async hasCurrent(userId: string, kind: ConsentKind): Promise<boolean> {
    const latest = await this.prisma.consent.findFirst({ where: { userId, kind }, orderBy: { createdAt: 'desc' } });
    return Boolean(latest?.granted && this.legal.acceptanceValid(kind, latest.version));
  }
}
