"use client";

import Link from "@/components/locale-link";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApp } from "./app-provider";
import { btn } from "./ui";

// Sign-up for the waiting list and newsletter (API.md §7.47). Consent is a separate, unticked box (ETK); the API
// answers the same for every address and mails a confirmation link, so the form only ever says "check your e-mail".
// The hidden "website" field is a honeypot for bots.

type Platform = "ios" | "android";

export function WaitlistForm({ source, compact = false }: { source: "home" | "footer"; compact?: boolean }) {
  const { t, locale } = useApp();
  const W = t.waitlist;
  const [email, setEmail] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "working" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const id = `wl-${source}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("working");
    try {
      await api.post("/waitlist", { email: email.trim(), locale, platforms, source, consent: true, ...(website ? { website } : {}) });
      setState("sent");
    } catch (err) {
      setState("idle");
      const code = err instanceof ApiError ? err.code : "";
      setError(code === "waitlist_closed" ? W.closed : code === "rate_limited" ? W.tooMany : code === "validation_failed" ? W.invalid : W.error);
    }
  }

  if (state === "sent") {
    return (
      <p className="flex gap-2.5 rounded-2xl bg-primary-soft p-4 text-sm text-primary" role="status">
        <CircleCheck className="h-5 w-5 shrink-0" aria-hidden /> {W.sent}
      </p>
    );
  }

  const toggle = (p: Platform) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className={compact ? "flex flex-col gap-2" : "flex flex-col gap-2 sm:flex-row"}>
        <label htmlFor={`${id}-email`} className="sr-only">
          {W.email}
        </label>
        <input
          id={`${id}-email`}
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          placeholder={W.email}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`h-11 w-full min-w-0 rounded-full border border-border bg-surface px-4 text-sm outline-none focus:border-primary ${compact ? "" : "sm:flex-1"}`}
        />
        <button type="submit" disabled={state === "working" || !consent || !email.trim()} className={`${btn.base} ${btn.primary} ${compact ? btn.md : btn.lg} shrink-0`}>
          {state === "working" && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          {W.submit}
        </button>
      </div>
      {!compact && (
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <legend className="sr-only">{W.platforms}</legend>
          <span className="text-muted" aria-hidden>
            {W.platforms}
          </span>
          {(["ios", "android"] as const).map((p) => (
            <label key={p} className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(p)} className="h-4 w-4 accent-[var(--primary)]" />
              {W[p]}
            </label>
          ))}
        </fieldset>
      )}
      <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted">
        <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]" />
        <span>
          {W.consent}{" "}
          <Link href="/yasal/pazarlama" className="underline underline-offset-2 hover:text-text">
            {W.consentLink}
          </Link>
        </span>
      </label>
      {/* Honeypot: invisible to people, filled by bots. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden value={website} onChange={(e) => setWebsite(e.target.value)} className="absolute -left-[9999px] h-px w-px opacity-0" />
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
