"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, ImagePlus, Images, LoaderCircle, Paperclip, SendHorizontal, Sparkles, X } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { ImageInputError, fileToUpload } from "@/lib/image";
import { clearChatPrefill, peekChatPrefill, setStudioPrefill } from "@/lib/prefill";
import type { Design, ImageRef, Page, Suggestion } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { ToolIcon } from "@/components/icons";
import { btn, card } from "@/components/ui";

type Msg = { role: "user" | "assistant"; text: string; image?: ImageRef; suggestions?: Suggestion[] };

const MAX_TEXT = 2000;
const MAX_HISTORY = 20;

export function Chat() {
  const { t, catalog, ensureSession } = useApp();
  const router = useRouter();
  const [initialImage] = useState(() => peekChatPrefill()?.image ?? null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<ImageRef | null>(initialImage);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recent, setRecent] = useState<ImageRef[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    clearChatPrefill();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const lastImage = [...messages].reverse().find((m) => m.image)?.image ?? attached ?? null;

  async function openPicker() {
    setPickerOpen((o) => !o);
    if (recent) return;
    try {
      await ensureSession();
      const page = await api.get<Page<Design>>("/designs?limit=12");
      setRecent(page.items.flatMap((d) => [...d.results, d.input]).slice(0, 18));
    } catch (e) {
      setRecent([]);
      setError(e);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const payload = await fileToUpload(file);
      await ensureSession();
      const { image } = await api.post<{ image: ImageRef }>("/uploads", payload);
      setAttached(image);
      setPickerOpen(false);
    } catch (e) {
      setError(
        e instanceof ImageInputError
          ? new ApiError(400, e.code === "too_large" ? "payload_too_large" : "unsupported_media_type", "")
          : e,
      );
    } finally {
      setUploading(false);
    }
  }

  async function send(content?: string) {
    const body = (content ?? text).trim().slice(0, MAX_TEXT);
    if (!body || busy) return;
    const next: Msg[] = [...messages, { role: "user", text: body, ...(attached ? { image: attached } : {}) }];
    setMessages(next);
    setText("");
    setAttached(null);
    setPickerOpen(false);
    setError(null);
    setBusy(true);
    try {
      await ensureSession();
      let history = next.slice(-MAX_HISTORY);
      while (history.length && history[0].role !== "user") history = history.slice(1);
      const res = await api.post<{ reply: string; suggestions: Suggestion[] }>("/chat", {
        messages: history.map((m) => ({ role: m.role, text: m.text, ...(m.image ? { imageId: m.image.id } : {}) })),
      });
      setMessages((prev) => [...prev, { role: "assistant", text: res.reply, suggestions: res.suggestions ?? [] }]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function openSuggestion(s: Suggestion) {
    // AI-01: a suggestion only pre-fills the studio; the user still has to press "Design".
    setStudioPrefill({
      tool: s.tool,
      styleId: s.styleId,
      roomId: s.roomId,
      instructions: s.instructions,
      image: lastImage ?? undefined,
      fromChat: true,
    });
    router.push("/studio");
  }

  const toolName = (id: string) => catalog?.tools.find((x) => x.id === id)?.name ?? id;

  return (
    <div className="mx-auto flex max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t.chat.title}</h1>
        <p className="mt-1.5 text-muted">{t.chat.subtitle}</p>
      </div>

      <div className={`${card} flex min-h-[28rem] flex-col`}>
        <div className="flex-1 space-y-5 p-4 sm:p-6" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-white">
                <Sparkles className="h-7 w-7" aria-hidden />
              </span>
              <p className="max-w-sm text-muted">{t.chat.empty}</p>
              <div className="flex flex-col gap-2 sm:items-center">
                {t.chat.starters.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setText(s)}
                    className="rounded-2xl border border-border px-4 py-2.5 text-left text-sm hover:border-primary hover:text-primary"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex flex-col items-end gap-2">
                {m.image && <img src={m.image.url} alt="" className="h-32 w-44 rounded-2xl object-cover" />}
                <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-primary px-4 py-2.5 text-sm text-white">
                  {m.text}
                </p>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                  <Bot className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-3">
                  {/* WEB-01: model output is rendered as plain text only. */}
                  <p className="whitespace-pre-wrap break-words rounded-3xl rounded-tl-lg bg-surface-2 px-4 py-3 text-sm leading-relaxed">
                    {m.text}
                  </p>
                  {m.suggestions && m.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {m.suggestions.map((s, j) => (
                        <button
                          key={j}
                          type="button"
                          onClick={() => openSuggestion(s)}
                          className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary-soft px-3.5 py-2 text-left text-sm font-semibold text-primary hover:border-primary"
                          title={`${toolName(s.tool)} — ${t.chat.openInStudio}`}
                        >
                          <ToolIcon tool={s.tool} className="h-4 w-4 shrink-0" />
                          <span>{s.label}</span>
                          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}

          {busy && (
            <div className="flex items-center gap-3 text-sm text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {t.chat.thinking}
            </div>
          )}
          {error ? <ErrorNotice error={error} /> : null}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border p-3 sm:p-4">
          {pickerOpen && (
            <div className="mb-3 rounded-2xl border border-border p-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className={`${btn.base} ${btn.ghost} ${btn.sm} mb-3`}
              >
                {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
                {t.chat.attachUpload}
              </button>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
                <Images className="h-3.5 w-3.5" aria-hidden /> {t.chat.attachRecent}
              </p>
              {recent === null ? (
                <LoaderCircle className="h-4 w-4 animate-spin text-muted" aria-hidden />
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {recent.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => {
                        setAttached(img);
                        setPickerOpen(false);
                      }}
                      className="h-16 w-20 shrink-0 overflow-hidden rounded-xl border-2 border-transparent hover:border-primary"
                    >
                      <img src={img.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {attached && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl bg-surface-2 p-2">
              <img src={attached.url} alt="" className="h-12 w-16 rounded-xl object-cover" />
              <span className="flex-1 text-sm text-muted">{t.chat.attached}</span>
              <button type="button" onClick={() => setAttached(null)} className={`${btn.base} ${btn.subtle} ${btn.icon}`} aria-label={t.chat.remove}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-end gap-2"
          >
            <button
              type="button"
              onClick={openPicker}
              className={`${btn.base} ${btn.ghost} ${btn.icon} shrink-0`}
              aria-label={t.chat.attach}
              aria-expanded={pickerOpen}
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              rows={1}
              value={text}
              maxLength={MAX_TEXT}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={t.chat.placeholder}
              className="max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              aria-label={t.chat.placeholder}
            />
            <button type="submit" disabled={busy || !text.trim()} className={`${btn.base} ${btn.primary} ${btn.icon} shrink-0`} aria-label={t.chat.send}>
              <SendHorizontal className="h-4 w-4" />
            </button>
          </form>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          <p className="mt-2 text-center text-[11px] text-muted">{t.chat.disclaimer}</p>
        </div>
      </div>
    </div>
  );
}
