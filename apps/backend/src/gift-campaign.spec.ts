import { GiftCampaignService, MAX_RECIPIENTS, PreviewSchema, SEGMENTS, SendSchema, segmentWhere } from './gifts/campaign.service.js';

// API.md §7.32: group gifts. Only real people (verified, active, not staff, not guests) are ever in a segment; a send
// refuses an empty or oversized group, a group that grew far past the preview, and the same gift twice in 10 minutes.
// (The SQL itself runs against PostgreSQL in the smoke test.)

const sqlOf = (s: { sql: string; values: unknown[] }) => s.sql.replace(/\s+/g, ' ');

describe('group gift segments', () => {
  it('every segment is limited to real, reachable people', () => {
    for (const seg of SEGMENTS) {
      const q = sqlOf(segmentWhere(seg, 30));
      expect(q).toContain(`u.role = 'USER'`);
      expect(q).toContain(`u.status = 'ACTIVE'`);
      expect(q).toContain('u."isGuest" = false');
      expect(q).toContain('u."emailVerifiedAt" IS NOT NULL');
    }
    expect(sqlOf(segmentWhere('inactive', 30))).toContain('COALESCE(u."lastSeenAt", u."createdAt") <');
    expect(sqlOf(segmentWhere('new', 7))).toContain('u."createdAt" >=');
    expect(sqlOf(segmentWhere('pro', null))).toContain('u."storeProUntil" >');
    const now = new Date('2026-11-06T00:00:00Z');
    // "not seen for 30 days" is measured from now: the cut-off is 30 days back.
    expect(segmentWhere('inactive', 30, now).values).toEqual([new Date('2026-10-07T00:00:00Z')]);
  });

  it('days are required where a segment needs them; amounts are bounded', () => {
    expect(PreviewSchema.safeParse({ segment: 'inactive' }).success).toBe(false);
    expect(PreviewSchema.safeParse({ segment: 'inactive', days: 30 }).success).toBe(true);
    expect(PreviewSchema.safeParse({ segment: 'pro' }).success).toBe(true);
    expect(PreviewSchema.safeParse({ segment: 'everyone' }).success).toBe(false);
    const ok = { segment: 'pro', credits: 5, reason: 'teşekkür', expected: 10 };
    expect(SendSchema.safeParse(ok).success).toBe(true);
    expect(SendSchema.safeParse({ ...ok, credits: 101 }).success).toBe(false);
    expect(SendSchema.safeParse({ ...ok, message: 'x'.repeat(141) }).success).toBe(false);
    expect(SendSchema.safeParse({ ...ok, reason: 'x' }).success).toBe(false);
  });
});

function service(count: number, recent: unknown = null) {
  const created: unknown[] = [];
  const prisma = {
    $queryRaw: async () => [{ n: BigInt(count), with_push: 0n }],
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: async () => [{ locked: 1 }],
        giftCampaign: { findFirst: async () => recent, create: async ({ data }: { data: unknown }) => (created.push(data), { id: 'c1', ...(data as object) }) },
      }),
  };
  return { svc: new GiftCampaignService(prisma as never, { send: async () => ({}) } as never), created };
}

const send = (over: Record<string, unknown> = {}) => SendSchema.parse({ segment: 'inactive', days: 30, credits: 3, reason: 'geri dönüş', expected: 100, ...over });

describe('sending a group gift', () => {
  it('refuses an empty group, an oversized one, and one that grew far past the preview', async () => {
    await expect(service(0).svc.send(send(), 'a')).rejects.toMatchObject({ status: 400, code: 'empty_segment' });
    await expect(service(MAX_RECIPIENTS + 1).svc.send(send({ expected: MAX_RECIPIENTS + 1 }), 'a')).rejects.toMatchObject({ status: 400, code: 'too_many' });
    const grew = service(200);
    await expect(grew.svc.send(send({ expected: 100 }), 'a')).rejects.toMatchObject({ status: 409, code: 'count_changed' });
    expect(grew.created).toEqual([]);
  });

  it('refuses the same gift again within 10 minutes (double click, second admin)', async () => {
    const f = service(100, { id: 'earlier' });
    await expect(f.svc.send(send(), 'a')).rejects.toMatchObject({ status: 409, code: 'duplicate_send' });
    expect(f.created).toEqual([]);
  });
});
