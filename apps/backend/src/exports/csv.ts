// CSV for the admin's exports (API.md §7.44): RFC 4180 quoting, a UTF-8 BOM so Excel shows Turkish letters, and the
// OWASP guard against formula injection — a cell starting with = + - @ tab or carriage return is prefixed with a quote
// so a spreadsheet never runs it as a formula.

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Numbers are written as numbers; anything else that looks like a formula is neutralised.
  if (typeof v !== 'number' && FORMULA.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
