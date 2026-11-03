import { NextResponse, type NextRequest } from "next/server";
import { PROFILE_COOKIE } from "@/lib/server/config";

// Display-only profile (name/e-mail) captured at login; authorization is always the backend's call.
export async function GET(req: NextRequest) {
  const raw = req.cookies.get(PROFILE_COOKIE)?.value;
  let profile: { email: string | null; name: string | null } = { email: null, name: null };
  if (raw) {
    try {
      const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
      profile = {
        email: typeof parsed.email === "string" ? parsed.email : null,
        name: typeof parsed.name === "string" ? parsed.name : null,
      };
    } catch {
      // keep empty profile
    }
  }
  return NextResponse.json(profile, { headers: { "cache-control": "no-store" } });
}
