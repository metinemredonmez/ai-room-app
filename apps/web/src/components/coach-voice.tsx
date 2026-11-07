"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Pause, Play, Volume2, X } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import type { Locale } from "@/lib/i18n";
import { useApp } from "./app-provider";

// API.md §7.54: the coach reads its own reply aloud. One audio element for the page: a new reply stops the previous
// one. The link is signed and expires within the hour; it is kept per reply and asked again only when it fails.
// Safari only lets audio start inside a tap: the element is unlocked with a silent clip during the tap, then the
// real file plays once it arrives; if the browser still refuses, the next tap plays it directly.

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

type Spoken = { url: string; at: number };
export type VoiceState = { id: string; status: "loading" | "playing" | "paused" | "blocked"; progress: number } | null;

export function useCoachVoice(locale: Locale, onError: (e: unknown) => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, Spoken>());
  const [state, setState] = useState<VoiceState>(null);

  const element = useCallback(() => {
    if (!audio.current) {
      const el = new Audio();
      el.preload = "auto";
      el.addEventListener("timeupdate", () =>
        setState((s) => (s && el.duration ? { ...s, progress: Math.min(1, el.currentTime / el.duration) } : s)),
      );
      // The silent unlock clip ends at once; only the real reply ending closes the bar.
      el.addEventListener("ended", () => {
        if (!el.src.startsWith("data:")) setState(null);
      });
      audio.current = el;
    }
    return audio.current;
  }, []);

  useEffect(() => () => audio.current?.pause(), []);

  const stop = useCallback(() => {
    audio.current?.pause();
    setState(null);
  }, []);

  const start = useCallback(
    async (id: string, url: string) => {
      const el = element();
      el.src = url;
      try {
        await el.play();
        setState({ id, status: "playing", progress: 0 });
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotAllowedError") setState({ id, status: "blocked", progress: 0 });
        else {
          urls.current.delete(id); // an expired link: ask again next time
          setState(null);
          onError(new ApiError(502, "voice_unavailable", ""));
        }
      }
    },
    [element, onError],
  );

  /** Tap on a reply's listen button: play, pause or resume. Must be called from the tap itself. */
  const toggle = useCallback(
    (id: string, text: string, token: string) => {
      const el = element();
      if (state?.id === id && state.status === "playing") {
        el.pause();
        setState({ ...state, status: "paused" });
        return;
      }
      if (state?.id === id && state.status === "paused") {
        void el.play().then(() => setState({ ...state, status: "playing" }));
        return;
      }
      const known = urls.current.get(id);
      if (known && Date.now() - known.at < 50 * 60_000) {
        void start(id, known.url);
        return;
      }
      el.pause();
      el.src = SILENT_WAV;
      void el.play().catch(() => undefined); // unlocks the element while we are still inside the tap
      setState({ id, status: "loading", progress: 0 });
      api
        .post<{ url: string; seconds: number }>("/coach/speak", { text, token, locale })
        .then((out) => {
          urls.current.set(id, { url: out.url, at: Date.now() });
          return start(id, out.url);
        })
        .catch((e: unknown) => {
          setState(null);
          onError(e);
        });
    },
    [element, locale, onError, start, state],
  );

  return { state, toggle, stop };
}

export function ListenButton({ active, onClick }: { active: VoiceState; onClick: () => void }) {
  const { t } = useApp();
  const status = active?.status;
  const label = status === "playing" ? t.chat.stopListening : status === "paused" ? t.chat.resume : status === "blocked" ? t.chat.tapToPlay : t.chat.listen;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={status === "playing"}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-primary"
    >
      {status === "loading" ? (
        <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
      ) : status === "playing" ? (
        <Pause className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Volume2 className="h-3.5 w-3.5" aria-hidden />
      )}
      {label}
    </button>
  );
}

/** The bar under the conversation while the coach speaks: progress, pause/resume, stop. */
export function VoiceBar({ state, onToggle, onStop }: { state: VoiceState; onToggle: () => void; onStop: () => void }) {
  const { t } = useApp();
  if (!state || state.status === "loading" || state.status === "blocked") return null;
  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl bg-primary-soft px-3 py-2 text-sm text-primary" role="status">
      <button type="button" onClick={onToggle} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-white" aria-label={state.status === "playing" ? t.chat.stopListening : t.chat.resume}>
        {state.status === "playing" ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{t.chat.nowPlaying}</p>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-primary/15" aria-hidden>
          <div className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${Math.round(state.progress * 100)}%` }} />
        </div>
      </div>
      <button type="button" onClick={onStop} className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-primary/10" aria-label={t.common.close}>
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
