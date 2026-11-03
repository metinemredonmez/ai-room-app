import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, PROFILE_COOKIE, SESSION_COOKIE } from "@/lib/server/config";
import { errorResponse, isSameOrigin } from "@/lib/server/guards";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return errorResponse(403, "forbidden", "İstek kaynağı doğrulanamadı.");
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  response.cookies.set(PROFILE_COOKIE, "", cookieOptions(0));
  return response;
}
