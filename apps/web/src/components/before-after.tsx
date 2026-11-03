"use client";

import { useState } from "react";
import { MoveHorizontal } from "lucide-react";

export function BeforeAfter({
  before,
  after,
  beforeLabel,
  afterLabel,
  sliderLabel,
  aspect,
}: {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
  sliderLabel: string;
  aspect?: number;
}) {
  const [pos, setPos] = useState(50);
  return (
    <div
      className="relative w-full select-none overflow-hidden rounded-3xl bg-surface-2"
      style={{ aspectRatio: aspect && Number.isFinite(aspect) ? String(aspect) : "4 / 3" }}
    >
      <img src={before} alt={beforeLabel} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <img
        src={after}
        alt={afterLabel}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
        draggable={false}
      />
      <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-primary/90 px-3 py-1 text-xs font-semibold text-white">
        {afterLabel}
      </span>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/95 shadow" style={{ left: `${pos}%` }}>
        <div className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-text shadow-lg">
          <MoveHorizontal className="h-5 w-5" aria-hidden />
        </div>
      </div>
      {/* A transparent native range input gives mouse, touch and keyboard dragging for free. */}
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label={sliderLabel}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
