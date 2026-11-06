"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { chosenPalette, setPalette, subscribePalette, type ThemeOptions } from "@/lib/palette";
import { useApp } from "./app-provider";
import { btn } from "./ui";

// The themes come from the admin (API.md §7.34) through the layout; without them (API unreachable) the menu is hidden
// and the site stays on the built-in theme.

const ThemeOptionsContext = createContext<ThemeOptions | null>(null);

export function ThemeOptionsProvider({ options, children }: { options: ThemeOptions | null; children: React.ReactNode }) {
  return <ThemeOptionsContext.Provider value={options}>{children}</ThemeOptionsContext.Provider>;
}

const safe = (c: string) => (/^#[0-9a-f]{6}$/.test(c) ? c : "transparent");

/** Colour-theme menu for the header (two columns: there are dozens of themes); the choice is remembered in this browser. */
export function PalettePicker({ className = "" }: { className?: string }) {
  const { locale } = useApp();
  const options = useContext(ThemeOptionsContext);
  const [open, setOpen] = useState(false);
  const chosen = useSyncExternalStore(subscribePalette, chosenPalette, () => null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!options || options.palettes.length < 2) return null;
  const label = locale === "tr" ? "Renk teması" : "Colour theme";
  const active = options.palettes.find((p) => p.id === chosen) ?? options.palettes.find((p) => p.id === options.defaultId) ?? options.palettes[0];

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        className={`${btn.base} ${btn.subtle} h-9 px-2.5`}
      >
        <span className="h-4 w-4 rounded-full ring-2 ring-surface shadow" style={{ background: safe(active.primary) }} />
      </button>
      {open && (
        <div
          role="radiogroup"
          aria-label={label}
          className="absolute right-0 top-11 z-50 grid max-h-[70vh] w-[min(27rem,calc(100vw-2rem))] grid-cols-2 gap-0.5 overflow-y-auto rounded-2xl border border-border bg-surface p-1.5 shadow-card"
        >
          {options.palettes.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active.id === p.id}
              onClick={() => {
                setPalette(p.id, options.defaultId);
                setOpen(false);
              }}
              className="flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-surface-2"
            >
              <span className="flex h-4 w-11 shrink-0 overflow-hidden rounded-full ring-1 ring-black/10" aria-hidden>
                {p.tones.map((t, i) => (
                  <span key={`${t}-${i}`} className="flex-1" style={{ background: safe(t) }} />
                ))}
              </span>
              <span className="flex-1 truncate">{locale === "tr" ? p.name.tr : p.name.en}</span>
              {active.id === p.id && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
