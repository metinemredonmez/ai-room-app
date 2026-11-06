import { isLate, isManualJob, MANUAL_JOBS } from './jobs/schedules.js';

// API.md §7.42: a scheduler is late when its next run is long overdue; only idempotent jobs can be run by hand.

describe('scheduled jobs', () => {
  const now = Date.parse('2026-12-01T12:00:00Z');
  it('late: more than 10 minutes overdue, or three intervals for the minute jobs', () => {
    expect(isLate(now - 9 * 60_000, undefined, now)).toBe(false);
    expect(isLate(now - 11 * 60_000, undefined, now)).toBe(true);
    expect(isLate(now - 11 * 60_000, 60_000, now)).toBe(true);
    expect(isLate(now + 60_000, 60_000, now)).toBe(false);
    expect(isLate(undefined, undefined, now)).toBe(false);
    expect(isLate(now - 11 * 60_000, 6 * 3_600_000, now)).toBe(false); // a 6-hour job gets three intervals of grace
  });

  it('only listed jobs run by hand (no store events, no Apple revocations)', () => {
    expect(MANUAL_JOBS).toContain('retention');
    expect(isManualJob('retention')).toBe(true);
    expect(isManualJob('revenuecat-event')).toBe(false);
    expect(isManualJob('apple-revoke')).toBe(false);
    expect(isManualJob('../retention')).toBe(false);
  });
});
