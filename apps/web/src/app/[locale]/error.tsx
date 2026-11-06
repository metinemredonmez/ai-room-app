"use client";

import { useEffect } from "react";
import { ErrorNotice } from "@/components/error-notice";
import { reportClientError } from "@/lib/client-errors";

/** A page that crashed while rendering: a calm message with "try again", and a report to our error list (§7.43). */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <ErrorNotice error={error} onRetry={reset} />
    </div>
  );
}
