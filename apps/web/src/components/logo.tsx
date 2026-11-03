import Link from "next/link";

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path d="M8 23V14.5L16 8l8 6.5V23" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M12.5 23v-5.5h7V23" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="24.5" cy="8.5" r="3" fill="var(--accent)" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap font-extrabold tracking-tight text-text">
      <LogoMark />
      <span className="text-lg">
        AI <span className="text-primary">Room</span>
      </span>
    </Link>
  );
}
