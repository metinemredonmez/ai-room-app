"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, Heart, LoaderCircle, MessageCircle, Receipt, RefreshCw, TriangleAlert } from "lucide-react";
import { api, downloadUrl } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { setChatPrefill, setStudioPrefill } from "@/lib/prefill";
import type { Analysis, Design } from "@/lib/types";
import { AnalysisPanel } from "./analysis-panel";
import { useApp } from "./app-provider";
import { BeforeAfter } from "./before-after";
import { ErrorNotice } from "./error-notice";
import { ToolIcon } from "./icons";
import { btn } from "./ui";

export function ResultView({ design, onChange }: { design: Design; onChange?: (d: Design) => void }) {
  const { t, locale, catalog } = useApp();
  const router = useRouter();
  const [selected, setSelected] = useState(0);
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [favBusy, setFavBusy] = useState(false);

  const result = design.results[Math.min(selected, design.results.length - 1)];
  const analysis = result ? analyses[result.id] : undefined;
  const toolName = catalog?.tools.find((x) => x.id === design.tool)?.name ?? design.tool;

  async function toggleFavorite() {
    setFavBusy(true);
    try {
      const updated = await api.patch<Design>(`/designs/${design.id}`, { favorite: !design.favorite });
      onChange?.(updated);
    } catch (e) {
      setError(e);
    } finally {
      setFavBusy(false);
    }
  }

  async function analyze() {
    if (!result) return;
    setAnalyzing(true);
    setError(null);
    try {
      const a = await api.post<Analysis>(`/designs/${design.id}/analysis`, { imageId: result.id });
      setAnalyses((prev) => ({ ...prev, [result.id]: a }));
    } catch (e) {
      setError(e);
    } finally {
      setAnalyzing(false);
    }
  }

  function iterate() {
    if (!result) return;
    setStudioPrefill({
      tool: design.tool,
      styleId: design.styleId ?? undefined,
      roomId: design.roomId ?? undefined,
      image: result,
    });
    router.push("/studio");
  }

  function askChat() {
    if (!result) return;
    setChatPrefill({ image: result });
    router.push("/sohbet");
  }

  if (design.status === "FAILED" || !result) {
    return (
      <div className="rounded-3xl border border-border bg-surface p-6 shadow-card">
        <div className="flex items-start gap-3">
          <TriangleAlert className="h-5 w-5 text-danger" aria-hidden />
          <div>
            <p className="font-medium">{t.result.failed}</p>
            {design.error && <p className="mt-1 text-sm text-muted">{design.error}</p>}
          </div>
        </div>
        <img src={design.input.url} alt={t.result.before} className="mt-4 w-full rounded-2xl object-cover" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[14rem] flex-1">
          <h2 className="text-xl font-medium sm:text-2xl">{design.title}</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <ToolIcon tool={design.tool} className="h-4 w-4" /> {toolName} · {formatDate(design.createdAt, locale)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={toggleFavorite}
            disabled={favBusy}
            className={`${btn.base} ${btn.ghost} ${btn.sm}`}
            aria-pressed={design.favorite}
            aria-label={design.favorite ? t.result.unfavorite : t.result.favorite}
          >
            <Heart className={`h-4 w-4 ${design.favorite ? "fill-accent text-accent" : ""}`} aria-hidden />
          </button>
          <a href={downloadUrl(result.url)} className={`${btn.base} ${btn.ghost} ${btn.sm}`}>
            <Download className="h-4 w-4" aria-hidden /> {t.result.download}
          </a>
          <button type="button" onClick={askChat} className={`${btn.base} ${btn.ghost} ${btn.sm}`}>
            <MessageCircle className="h-4 w-4" aria-hidden /> {t.result.askChat}
          </button>
          <button type="button" onClick={iterate} className={`${btn.base} ${btn.ghost} ${btn.sm}`}>
            <RefreshCw className="h-4 w-4" aria-hidden /> {t.result.iterate}
          </button>
        </div>
      </div>

      <BeforeAfter
        before={design.input.url}
        after={result.url}
        beforeLabel={t.result.before}
        afterLabel={t.result.after}
        sliderLabel={t.result.sliderLabel}
        aspect={result.width && result.height ? result.width / result.height : undefined}
      />

      {design.results.length > 1 && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted">{t.result.variants}</p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {design.results.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(i)}
                className={`relative h-20 w-28 shrink-0 overflow-hidden rounded-2xl border-2 transition ${
                  i === selected ? "border-primary" : "border-transparent opacity-75 hover:opacity-100"
                }`}
                aria-label={`${t.result.variants} ${i + 1}`}
                aria-pressed={i === selected}
              >
                <img src={r.url} alt="" className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 text-[10px] font-medium text-white">{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error ? <ErrorNotice error={error} /> : null}

      {analysis ? (
        <AnalysisPanel analysis={analysis} />
      ) : (
        <button type="button" onClick={analyze} disabled={analyzing} className={`${btn.base} ${btn.accent} ${btn.md} w-full sm:w-auto`}>
          {analyzing ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Receipt className="h-4 w-4" aria-hidden />}
          {analyzing ? t.result.analyzing : t.result.analyze}
        </button>
      )}
    </div>
  );
}
