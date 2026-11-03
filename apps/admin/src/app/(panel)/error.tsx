"use client";

import { ErrorState } from "@/components/common";

export default function PanelError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState message="Bu sayfa yüklenirken beklenmeyen bir hata oluştu." onRetry={reset} />;
}
