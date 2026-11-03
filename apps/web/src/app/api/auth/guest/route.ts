import type { NextRequest } from "next/server";
import { csrfRejected, getOrCreateDeviceId, isSameOrigin } from "@/lib/server/backend";
import { exchangeForSession } from "@/lib/server/auth-route";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return csrfRejected();
  const deviceId = await getOrCreateDeviceId();
  return exchangeForSession({
    method: "POST",
    path: "/auth/guest",
    body: JSON.stringify({ deviceId }),
    contentType: "application/json",
  });
}
