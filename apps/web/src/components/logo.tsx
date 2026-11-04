import Link from "next/link";

/**
 * Casalume mark: an arched doorway with light spilling onto the floor and a spark above ("lume").
 * Paths repeat scripts/brand-icons.mjs (the app icon source); change both together. The tile stays the brand's
 * warm ink in every colour theme.
 */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={`shrink-0 ${className}`} aria-hidden focusable="false">
      <rect width="1024" height="1024" rx="228" fill="#1c1714" />
      <g transform="translate(-25 -14)">
        <path d="M402 744V452a110 110 0 0 1 220 0v292z" fill="#e07a52" fillOpacity={0.2} />
        <path d="M402 744h220l100 124H302z" fill="#e07a52" fillOpacity={0.4} />
        <path d="M372 744V452a140 140 0 0 1 280 0v292" fill="none" stroke="#e07a52" strokeWidth={60} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M730 198q15 77 92 92q-77 15-92 92q-15-77-92-92q77-15 92-92z" fill="#f3ece2" />
      </g>
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5 whitespace-nowrap font-display font-light text-text">
      <LogoMark className="h-8 w-8 rounded-[9px]" />
      <span className="text-2xl leading-none tracking-wide">
        Casa<span className="text-primary">lume</span>
      </span>
    </Link>
  );
}
