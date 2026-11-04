/**
 * Casalume mark: an arched doorway with light spilling onto the floor and a spark above ("lume").
 * Paths repeat scripts/brand-icons.mjs (the app icon source); change both together.
 *
 * - `tile`: the rounded dark app-icon square (sidebar, login card); otherwise the bare mark (dark brand panel).
 * - `animated`: the arch draws itself, the light spills out, the spark pops and keeps twinkling
 *   (globals.css `.brand-anim`; reduced-motion users get the still frame).
 */
export function BrandMark({ size = 32, tile = true, animated = false, className = "" }: { size?: number; tile?: boolean; animated?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={`shrink-0 ${animated ? "brand-anim" : ""} ${className}`}
    >
      {tile && <rect width="1024" height="1024" rx="228" fill="#1c1714" />}
      <g transform="translate(-25 -14)">
        <g className="brand-breathe">
          <path className="brand-in" d="M402 744V452a110 110 0 0 1 220 0v292z" fill="#e07a52" fillOpacity={0.2} />
          <path className="brand-beam" d="M402 744h220l100 124H302z" fill="#e07a52" fillOpacity={0.4} />
        </g>
        <path
          className="brand-arch"
          pathLength={1}
          d="M372 744V452a140 140 0 0 1 280 0v292"
          fill="none"
          stroke="#e07a52"
          strokeWidth={60}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <g className="brand-pop">
          <path className="brand-twinkle" d="M730 198q15 77 92 92q-77 15-92 92q-15-77-92-92q77-15 92-92z" fill="#f3ece2" />
        </g>
      </g>
    </svg>
  );
}
