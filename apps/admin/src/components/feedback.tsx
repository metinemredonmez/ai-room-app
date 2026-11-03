"use client";

import { CheckCircle2, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./ui";

type Toast = { id: number; tone: "success" | "error"; message: string };
type ConfirmOptions = { title: string; description?: string; confirmLabel?: string; destructive?: boolean };

type FeedbackApi = {
  toast: (tone: Toast["tone"], message: string) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
};

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used inside <FeedbackProvider>");
  return ctx;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((tone: Toast["tone"], message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  );

  const close = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-fg shadow-lg"
          >
            {t.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-label="Başarılı" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-label="Hata" />
            )}
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              className="text-muted hover:text-fg"
              aria-label="Kapat"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      {pending && <ConfirmDialog opts={pending} onClose={close} />}
    </FeedbackContext.Provider>
  );
}

function ConfirmDialog({ opts, onClose }: { opts: ConfirmOptions; onClose: (v: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => onClose(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-base font-semibold text-fg">
          {opts.title}
        </h2>
        {opts.description && <p className="mt-1.5 text-sm text-muted">{opts.description}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => onClose(false)}>Vazgeç</Button>
          <Button ref={confirmRef} variant={opts.destructive ? "danger" : "primary"} onClick={() => onClose(true)}>
            {opts.confirmLabel ?? "Onayla"}
          </Button>
        </div>
      </div>
    </div>
  );
}
