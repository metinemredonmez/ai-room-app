import type { NextRequest } from "next/server";
import { allowedImageOrigins, jsonError } from "@/lib/server/backend";

// Same-origin download helper for signed backend image URLs (cross-origin <a download> is ignored
// by browsers). Only backend image paths are fetched — never an arbitrary URL (SSRF guard).

const IMAGE_PATH = /^\/v1\/images\/[0-9a-fA-F-]{36}$/;
const MAX_BYTES = 25 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get("src");
  let url: URL;
  try {
    url = new URL(src ?? "");
  } catch {
    return jsonError(400, "bad_request", "Geçersiz görsel adresi.");
  }
  if (!allowedImageOrigins().has(url.origin) || !IMAGE_PATH.test(url.pathname) || url.username || url.password) {
    return jsonError(400, "bad_request", "Geçersiz görsel adresi.");
  }
  try {
    const res = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return jsonError(404, "not_found", "Görsel bulunamadı ya da süresi doldu.");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return jsonError(413, "payload_too_large", "Görsel çok büyük.");
    const id = url.pathname.split("/").pop();
    return new Response(buf, {
      headers: {
        "content-type": "image/jpeg",
        "content-disposition": `attachment; filename="casalume-${id}.jpg"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return jsonError(502, "ai_unavailable", "Görsel indirilemedi.");
  }
}
