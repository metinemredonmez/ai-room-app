// Vector "before / after" room used on the landing page (no stock photos needed).

function Shell({ wall, side, ceiling, floor, children }: { wall: string; side: string; ceiling: string; floor: string; children?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 800 520" className="h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfe0f2" />
          <stop offset="1" stopColor="#eef6f9" />
        </linearGradient>
        <linearGradient id="light" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points="0,0 800,0 680,48 120,48" fill={ceiling} />
      <rect x="120" y="48" width="560" height="300" fill={wall} />
      <polygon points="0,0 120,48 120,348 0,520" fill={side} />
      <polygon points="800,0 680,48 680,348 800,520" fill={side} />
      <polygon points="120,348 680,348 800,520 0,520" fill={floor} />
      {/* window */}
      <rect x="430" y="86" width="190" height="170" rx="4" fill="url(#sky)" stroke="#fff" strokeWidth="8" />
      <line x1="525" y1="86" x2="525" y2="256" stroke="#fff" strokeWidth="6" />
      <line x1="430" y1="170" x2="620" y2="170" stroke="#fff" strokeWidth="6" />
      <polygon points="430,256 620,256 700,420 360,420" fill="url(#light)" />
      {children}
    </svg>
  );
}

export function RoomBefore() {
  return (
    <Shell wall="#cfccc6" side="#bcb8b1" ceiling="#dad7d1" floor="#a8a196">
      {/* bare bulb */}
      <line x1="300" y1="48" x2="300" y2="96" stroke="#555" strokeWidth="2" />
      <circle cx="300" cy="102" r="9" fill="#f4f0d8" />
      {/* boxes and clutter */}
      <rect x="170" y="290" width="110" height="80" fill="#b48a5a" />
      <rect x="170" y="290" width="110" height="10" fill="#9c7448" />
      <rect x="250" y="320" width="70" height="55" fill="#c39a69" />
      <rect x="560" y="360" width="90" height="12" rx="3" fill="#7f7a72" />
      <path d="M380 470 q40 -20 90 0 t90 0" stroke="#6c665e" strokeWidth="3" fill="none" />
      <rect x="140" y="160" width="60" height="44" fill="none" stroke="#a9a59e" strokeWidth="3" strokeDasharray="6 6" />
    </Shell>
  );
}

export function RoomAfter() {
  return (
    <Shell wall="#ece0cf" side="#dfcfb9" ceiling="#f4ece0" floor="#c49465">
      {/* floor planks */}
      {[380, 410, 445, 485].map((y) => (
        <line key={y} x1="0" y1={y + 40} x2="800" y2={y + 40} stroke="#b27f52" strokeWidth="2" opacity="0.5" />
      ))}
      {/* pendant */}
      <line x1="300" y1="48" x2="300" y2="104" stroke="#2b2b2b" strokeWidth="2" />
      <path d="M272 128 q28 -40 56 0 z" fill="#1f6f5c" />
      <ellipse cx="300" cy="132" rx="24" ry="5" fill="#ffe7b0" opacity="0.9" />
      {/* art */}
      <rect x="168" y="120" width="76" height="96" rx="3" fill="#fff" stroke="#3a3a3a" strokeWidth="3" />
      <circle cx="206" cy="160" r="22" fill="#e07a4f" />
      <rect x="186" y="186" width="40" height="14" fill="#1f6f5c" />
      <rect x="258" y="140" width="56" height="56" rx="3" fill="#fff" stroke="#3a3a3a" strokeWidth="3" />
      <path d="M266 186 l14 -24 l12 16 l8 -10 l10 18 z" fill="#c9a36a" />
      {/* rug */}
      <ellipse cx="320" cy="420" rx="230" ry="48" fill="#f6efe4" />
      <ellipse cx="320" cy="420" rx="200" ry="38" fill="none" stroke="#e07a4f" strokeWidth="3" strokeDasharray="10 8" />
      {/* sofa */}
      <rect x="150" y="262" width="300" height="80" rx="22" fill="#1f6f5c" />
      <rect x="140" y="300" width="320" height="66" rx="20" fill="#24806a" />
      <rect x="128" y="290" width="40" height="84" rx="18" fill="#1b5f4f" />
      <rect x="432" y="290" width="40" height="84" rx="18" fill="#1b5f4f" />
      <rect x="196" y="272" width="56" height="44" rx="12" fill="#e07a4f" />
      <rect x="348" y="272" width="56" height="44" rx="12" fill="#f2c57c" />
      <rect x="160" y="370" width="8" height="18" fill="#3a2a1d" />
      <rect x="432" y="370" width="8" height="18" fill="#3a2a1d" />
      {/* coffee table */}
      <ellipse cx="320" cy="430" rx="80" ry="16" fill="#8a5a36" />
      <rect x="300" y="430" width="8" height="26" fill="#6f4729" />
      <rect x="334" y="430" width="8" height="26" fill="#6f4729" />
      <circle cx="300" cy="420" r="9" fill="#fff" />
      {/* plant */}
      <path d="M590 380 h56 l-8 60 h-40 z" fill="#d9c3a5" />
      <ellipse cx="600" cy="340" rx="26" ry="44" fill="#2f7a4f" transform="rotate(-25 600 340)" />
      <ellipse cx="636" cy="330" rx="24" ry="48" fill="#3a9160" transform="rotate(20 636 330)" />
      <ellipse cx="618" cy="310" rx="18" ry="46" fill="#27683f" />
      {/* floor lamp */}
      <line x1="520" y1="250" x2="520" y2="430" stroke="#2b2b2b" strokeWidth="4" />
      <path d="M496 250 h48 l-10 -34 h-28 z" fill="#f2e3c6" />
      <ellipse cx="520" cy="434" rx="18" ry="5" fill="#2b2b2b" />
    </Shell>
  );
}

/** Auto-animated showcase: the "after" layer sweeps back and forth over "before". */
export function HeroShowcase({ beforeLabel, afterLabel }: { beforeLabel: string; afterLabel: string }) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[2rem] border border-border bg-surface shadow-card">
      <div className="absolute inset-0">
        <RoomBefore />
      </div>
      <div className="absolute inset-0 animate-sweep" style={{ clipPath: "inset(0 50% 0 0)" }}>
        <RoomAfter />
      </div>
      <div className="absolute inset-y-0 w-0.5 animate-sweep-handle bg-white shadow" style={{ left: "50%" }}>
        <div className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-primary shadow-lg" />
      </div>
      <span className="absolute left-4 top-4 rounded-full bg-primary/90 px-3 py-1 text-xs font-semibold text-white">{afterLabel}</span>
      <span className="absolute right-4 top-4 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white">{beforeLabel}</span>
    </div>
  );
}
