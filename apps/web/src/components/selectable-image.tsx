"use client";

import { useEffect, useState } from "react";
import type { Point } from "@/lib/types";

const MAX_SIDE = 1024;

/** Grayscale selection mask (255 = selected) → white PNG whose alpha is the mask, used as a CSS mask over the tint. */
async function alphaMask(src: string): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const alpha = px[i];
    px[i] = px[i + 1] = px[i + 2] = 255;
    px[i + 3] = alpha;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Math.round(v * 10_000) / 10_000));

/**
 * The input photo, tappable for object selection (API.md §7.15): each tap reports a 0..1 point, the selected
 * area is tinted with the theme colour and every committed tap gets a numbered marker.
 */
export function SelectableImage({
  src,
  alt,
  width,
  height,
  enabled,
  points,
  pending,
  mask,
  onTap,
  children,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  enabled: boolean;
  points: Point[];
  pending: Point | null;
  mask: string | null;
  onTap: (p: Point) => void;
  children?: React.ReactNode;
}) {
  // Converted masks by source, so "undo" back to an earlier selection shows its tint at once.
  const [overlays, setOverlays] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!mask) return;
    let alive = true;
    alphaMask(mask)
      .then((url) => alive && setOverlays((prev) => (prev[mask] ? prev : { ...prev, [mask]: url })))
      .catch(() => undefined); // no tint; the numbered markers still show the selection
    return () => {
      alive = false;
    };
  }, [mask]);

  const tint = mask ? (overlays[mask] ?? null) : null;

  return (
    <div className="relative">
      <img
        src={src}
        alt={alt}
        draggable={false}
        onClick={(e) => {
          if (!enabled) return;
          const r = e.currentTarget.getBoundingClientRect();
          onTap({ x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) });
        }}
        className={`w-full select-none rounded-3xl object-cover ${enabled ? "cursor-crosshair" : ""}`}
        style={{ aspectRatio: `${width} / ${height}` }}
      />
      {tint && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-3xl bg-primary/55 transition-opacity"
          style={{
            maskImage: `url(${tint})`,
            WebkitMaskImage: `url(${tint})`,
            maskSize: "100% 100%",
            WebkitMaskSize: "100% 100%",
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
          }}
        />
      )}
      {points.map((p, i) => (
        <span
          key={`${p.x}-${p.y}-${i}`}
          aria-hidden
          className="pointer-events-none absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-[11px] font-medium text-white shadow-card ring-2 ring-white"
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
        >
          {i + 1}
        </span>
      ))}
      {pending && (
        <span
          aria-hidden
          className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-primary/70"
          style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }}
        />
      )}
      {children}
    </div>
  );
}
