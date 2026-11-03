import "server-only";

export const SESSION_COOKIE = "air_admin";
export const PROFILE_COOKIE = "air_admin_profile";

export function apiBaseUrl(): string {
  return (process.env.API_BASE_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");
}

export const isProd = process.env.NODE_ENV === "production";

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}
