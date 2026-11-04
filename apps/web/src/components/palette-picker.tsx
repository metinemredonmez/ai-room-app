"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { currentPalette, PALETTES, setPalette, subscribePalette } from "@/lib/palette";
import { useApp } from "./app-provider";
import { btn } from "./ui";

/** Small colour-theme menu for the header: four swatches, the choice is remembered in this browser. */
export function PalettePicker({ className = "" }: { className?: string }) {
  const { locale } = useApp();
  const [open, setOpen] = useState(false);
  const active = useSyncExternalStore(subscribePalette, currentPalette, () => "kil" as const);
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

  const label = locale === "tr" ? "Renk teması" : "Colour theme";
  const current = PALETTES.find((p) => p.id === active) ?? PALETTES[0];

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
        <span className="h-4 w-4 rounded-full ring-2 ring-surface shadow" style={{ background: current.swatch }} />
      </button>
      {open && (
        <div
          role="radiogroup"
          aria-label={label}
          className="absolute right-0 top-11 z-50 w-48 rounded-2xl border border-border bg-surface p-1.5 shadow-card"
        >
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active === p.id}
              onClick={() => {
                setPalette(p.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <span className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ background: p.swatch }} />
              <span className="flex-1">{locale === "tr" ? p.tr : p.en}</span>
              {active === p.id && <Check className="h-4 w-4 text-primary" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
