import { csvCell, toCsv } from './exports/csv.js';
import { exportRange, isExportKind } from './exports/exports.service.js';

// API.md §7.44: admin CSV exports — quoting, no formula injection, Excel-friendly, bounded ranges.

describe('CSV', () => {
  it('quotes separators, quotes and new lines (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(3.5)).toBe('3.5');
    expect(csvCell(-2)).toBe('-2'); // a real number stays a number
    expect(csvCell(new Date('2026-12-01T10:00:00Z'))).toBe('2026-12-01T10:00:00.000Z');
  });

  it('neutralises anything a spreadsheet would run as a formula (OWASP CSV injection)', () => {
    for (const evil of ['=HYPERLINK("http://x","click")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvCell('normal text')).toBe('normal text');
  });

  it('starts with a BOM and uses CRLF rows', () => {
    const out = toCsv(['a', 'b'], [[1, 'x'], [2, '=y']]);
    expect(out.startsWith('﻿a,b\r\n1,x\r\n2,')).toBe(true);
    expect(out).toContain("'=y");
  });
});

describe('export ranges', () => {
  const now = new Date('2026-12-15T12:00:00Z');
  it('defaults to the last 30 days; takes Istanbul days; at most 366 days', () => {
    const d = exportRange(undefined, undefined, now);
    expect(d.lt.getTime() - d.gte.getTime()).toBe(30 * 86_400_000);
    const r = exportRange('2026-12-01', '2026-12-01', now);
    expect(r.gte.toISOString()).toBe('2026-11-30T21:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-12-01T21:00:00.000Z');
    expect(() => exportRange('2025-01-01', '2026-12-01', now)).toThrow(/366/);
    expect(() => exportRange('2026-12-05', '2026-12-01', now)).toThrow();
    expect(() => exportRange('01/12/2026', undefined, now)).toThrow(/YYYY/);
  });
  it('only known kinds', () => {
    expect(isExportKind('audit')).toBe(true);
    expect(isExportKind('users')).toBe(false);
  });
});
