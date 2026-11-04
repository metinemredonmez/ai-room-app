"use client";

import { ArrowLeftRight, Clock, ImageOff } from "lucide-react";
import { useState, type ImgHTMLAttributes } from "react";
import type { Design, ImageRef } from "@/lib/types";

// Shared pieces for showing generated designs (designs vault, content reports).

export function Img({ alt, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string }) {
  // Images come from the API's own signed URLs; next/image would add nothing but a proxy hop.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" {...props} />;
}

export function NoResult({ status }: { status: Design["status"] }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1.5 text-xs text-muted-foreground">
      {status === "PENDING" ? <Clock className="size-5" aria-hidden /> : <ImageOff className="size-5" aria-hidden />}
      {status === "PENDING" ? "Üretiliyor" : "Sonuç yok"}
    </div>
  );
}

/** Before/after wipe: the range input on top keeps it keyboard- and screen-reader-operable. */
export function Compare({ before, after }: { before: ImageRef; after: ImageRef }) {
  const [pos, setPos] = useState(50);
  const ratio = after.width > 0 && after.height > 0 ? `${after.width} / ${after.height}` : "4 / 3";
  return (
    <div className="relative overflow-hidden rounded-lg bg-muted select-none" style={{ aspectRatio: ratio }}>
      <Img src={after.url} alt="Sonra: üretilen tasarım" className="absolute inset-0 size-full object-cover" />
      <Img src={before.url} alt="Önce: yüklenen fotoğraf" className="absolute inset-0 size-full object-cover" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow" style={{ left: `${pos}%` }} aria-hidden>
        <span className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-neutral-900 shadow-md">
          <ArrowLeftRight className="size-4" />
        </span>
      </div>
      <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">Önce</span>
      <span className="pointer-events-none absolute top-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">Sonra</span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Önce ve sonra karşılaştırması"
        className="absolute inset-0 size-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
