"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { Design } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { ResultView } from "@/components/result-view";

const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function DesignDetail() {
  const { t, userReady } = useApp();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" && ID.test(params.id) ? params.id : null;
  const [design, setDesign] = useState<Design | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!userReady || !id) return;
    let alive = true;
    api
      .get<Design>(`/designs/${id}`)
      .then((d) => alive && setDesign(d))
      .catch((e: unknown) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [id, userReady, nonce]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/tasarimlarim" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t.designs.title}
      </Link>
      {!id ? (
        <p className="text-muted">{t.errors.not_found}</p>
      ) : error ? (
        <ErrorNotice
          error={error}
          onRetry={() => {
            setError(null);
            setNonce((n) => n + 1);
          }}
        />
      ) : design ? (
        <ResultView design={design} onChange={setDesign} />
      ) : (
        <p className="flex items-center gap-2 text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {t.common.loading}
        </p>
      )}
    </div>
  );
}
