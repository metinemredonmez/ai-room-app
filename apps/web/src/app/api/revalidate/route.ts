import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
// On-demand purge of this site's tagged caches (Next "use cache"), called by the API when content
// changes: a blog article is published/unpublished or an approved SEO text goes live (API.md §7.18).
// Without the shared secret (WEB_REVALIDATE_SECRET) the answer is always 401 — the tag list is a
// fixed allow-list, so a leaked secret alone cannot purge anything else.
const TAGS = new Set(["blog", "seo"]);

export async function POST(request: NextRequest) {
  const expected = process.env.WEB_REVALIDATE_SECRET;
  if (!expected || request.headers.get("x-revalidate-secret") !== expected) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Yetkisiz." } }, { status: 401 });
  }
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const wanted = (body as { tags?: unknown } | null)?.tags;
  const tags = Array.isArray(wanted) ? wanted.filter((t): t is string => typeof t === "string" && TAGS.has(t)) : [];
  if (!tags.length) {
    return NextResponse.json({ error: { code: "bad_request", message: "Geçersiz etiket." } }, { status: 400 });
  }
  // Cache Components: the second argument is the revalidation profile; 'max' serves stale briefly
  // while the fresh copy renders (stale-while-revalidate), so a publish is visible at once.
  for (const tag of tags) revalidateTag(tag, "max");
  return NextResponse.json({ ok: true, tags });
}
