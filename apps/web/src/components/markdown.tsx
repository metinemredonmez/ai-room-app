import type { ReactNode } from "react";
import Link from "next/link";
import { localePath, type Locale } from "@/lib/i18n";

// Blog bodies (API.md §7.18) and legal texts are a small Markdown subset: "## "/"### " headings, paragraphs,
// "- " and "1. " lists, | pipe | tables |, **bold**, *italic* and links to our own pages. Rendered as React
// elements — never as HTML (WEB-01) — and any link outside the allowed paths becomes plain text (EXT-02).
// A leading "# " title is dropped: the page shows the title itself.

const ALLOWED = /^\/(studio|fiyatlar|sohbet|blog)(\/[a-z0-9-]{1,80})?(\?[a-z_]{1,20}=[a-z0-9_-]{1,40})?$/;

function inline(text: string, locale: Locale, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let i = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<strong key={k}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={k}>{m[2]}</em>);
    else if (m[3]) {
      const href = m[4];
      out.push(
        ALLOWED.test(href) ? (
          <Link key={k} href={localePath(locale, href)} className="text-primary underline underline-offset-2 hover:text-primary-strong">
            {m[3]}
          </Link>
        ) : (
          <span key={k}>{m[3]}</span>
        ),
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

export function Markdown({ source, locale }: { source: string; locale: Locale }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] | null = null;
  const flush = () => {
    const k = `b${blocks.length}`;
    if (table) {
      const [head, ...rows] = table;
      blocks.push(
        <div key={`${k}t`} className="my-5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>{head.map((c, j) => <th key={j} className="border-b border-border px-3 py-2 text-left font-medium">{inline(c, locale, `${k}-h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-border px-3 py-2 align-top">{inline(c, locale, `${k}-${i}-${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      table = null;
    }
    if (para.length) {
      // Hard-wrapped prose (long lines) joins into one paragraph; short lines such as an address block keep their
      // line breaks.
      const parts: ReactNode[] = [];
      para.forEach((line, i) => {
        if (i > 0) parts.push(para[i - 1].length >= 80 ? " " : <br key={`${k}-br${i}`} />);
        parts.push(...inline(line, locale, `${k}-${i}`));
      });
      blocks.push(<p key={k} className="my-4 leading-relaxed">{parts}</p>);
      para = [];
    }
    if (list) {
      const items = list.items.map((it, j) => <li key={j}>{inline(it, locale, `${k}-${j}`)}</li>);
      blocks.push(
        list.ordered ? (
          <ol key={`${k}l`} className="my-4 list-decimal space-y-1.5 pl-6">{items}</ol>
        ) : (
          <ul key={`${k}l`} className="my-4 list-disc space-y-1.5 pl-6">{items}</ul>
        ),
      );
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\|.*\|$/.test(line)) {
      if (!table) flush();
      if (!/^\|[\s:|-]+\|$/.test(line)) (table ??= []).push(cells(line)); // the |---| separator row is skipped
      continue;
    }
    if (table) flush();
    if (/^#\s+/.test(line) && !blocks.length && !para.length) continue; // the document title
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const num = /^\d+[.)]\s+(.+)$/.exec(line);
    if (!line) flush();
    else if (h) {
      flush();
      const k = `h${blocks.length}`;
      blocks.push(
        h[1] === "##" ? (
          <h2 key={k} className="mt-10 mb-3 font-display text-2xl font-light">{inline(h[2], locale, k)}</h2>
        ) : (
          <h3 key={k} className="mt-8 mb-2 text-lg font-medium">{inline(h[2], locale, k)}</h3>
        ),
      );
    } else if (bullet || num) {
      if (para.length) flush();
      const ordered = Boolean(num);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? num)![1]);
    } else if (list) {
      // A wrapped line right after a list item continues that item.
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      para.push(line.replace(/^#\s+/, ""));
    }
  }
  flush();
  return <div className="text-[17px] text-text">{blocks}</div>;
}
