"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useApp } from "./app-provider";

export function useErrorText() {
  const { t } = useApp();
  return (err: unknown): string => {
    if (!(err instanceof ApiError)) return t.errors.generic;
    switch (err.code) {
      case "insufficient_credits":
        return t.errors.insufficient_credits;
      case "rate_limited":
        return t.errors.rate_limited(err.retryAfter);
      case "ai_unavailable":
        return t.errors.ai_unavailable;
      case "busy":
        return t.errors.busy;
      case "payload_too_large":
        return t.errors.payload_too_large;
      case "unsupported_media_type":
        return t.errors.unsupported_media_type;
      case "unauthorized":
        return t.errors.unauthorized;
      case "forbidden":
        return err.message || t.errors.forbidden;
      case "not_found":
        return t.errors.not_found;
      case "network":
        return t.errors.network;
      case "validation_failed":
      case "bad_request":
      case "conflict":
        return err.message || t.errors.generic;
      default:
        if (err.status === 502) return t.errors.ai_unavailable;
        if (err.status === 503) return t.errors.busy;
        return t.errors.generic;
    }
  };
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useApp();
  const text = useErrorText()(error);
  const needsPlan = error instanceof ApiError && (error.code === "insufficient_credits" || error.status === 402);
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-text">
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
      <div className="flex-1">
        <p>{text}</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {needsPlan && (
            <Link href="/fiyatlar" className="font-medium text-primary underline-offset-4 hover:underline">
              {t.errors.seePlans} →
            </Link>
          )}
          {onRetry && (
            <button type="button" onClick={onRetry} className="font-medium text-primary underline-offset-4 hover:underline">
              {t.common.retry}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
