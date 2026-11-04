// Shared Tailwind class recipes.

export const btn = {
  base: "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]",
  primary: "bg-primary text-white hover:bg-primary-strong shadow-card",
  accent: "bg-accent text-text hover:brightness-95 shadow-card",
  ghost: "border border-border bg-surface text-text hover:bg-surface-2",
  subtle: "text-muted hover:text-text hover:bg-surface-2",
  md: "h-11 px-5 text-sm",
  lg: "h-13 px-7 text-base",
  sm: "h-9 px-3.5 text-sm",
  icon: "h-10 w-10",
};

export const card = "rounded-3xl border border-border bg-surface shadow-card";
export const input =
  "w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-text placeholder:text-muted/70 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
export const label = "mb-2 block text-sm font-medium text-text";
export const chip = (active: boolean) =>
  `inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition ${
    active ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-text hover:border-muted/50"
  }`;
