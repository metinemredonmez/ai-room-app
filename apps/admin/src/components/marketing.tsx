"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/api";
import { LOCALES, LOCALE_LABELS, type Locale, type MarketingDraft, type MarketingDraftStatus } from "@/lib/types";

// Shared pieces of the Pazarlama screens (API.md §7.18).

export const DRAFT_STATUS: Record<MarketingDraftStatus, { label: string; className: string }> = {
  PENDING: { label: "Yazılıyor", className: "bg-warn-soft text-warn" },
  READY: { label: "Onay bekliyor", className: "bg-primary/10 text-primary" },
  FAILED: { label: "Başarısız", className: "bg-danger/10 text-danger" },
  APPROVED: { label: "Onaylı", className: "bg-good-soft text-good" },
  ARCHIVED: { label: "Arşiv", className: "bg-secondary text-secondary-foreground" },
};

export const DRAFT_ERRORS: Record<string, string> = {
  ai_unavailable: "Yapay zekâ yanıt vermedi",
  timeout: "Zaman aşımı",
  internal: "Beklenmeyen hata",
};

export function StatusBadge({ status }: { status: MarketingDraftStatus }) {
  return (
    <Badge className={DRAFT_STATUS[status].className}>
      {status === "PENDING" && <Loader2 className="size-3 animate-spin" />}
      {DRAFT_STATUS[status].label}
    </Badge>
  );
}

/** Drafts of one kind; refreshes every 5 s while any is still being written. */
export function useDrafts<O>(kind: "aso" | "social" | "campaign" | "report") {
  const res = useApi<{ items: MarketingDraft<O>[] }>("/marketing/drafts", { kind });
  const items = useMemo(() => res.data?.items ?? [], [res.data]);
  const pending = items.some((d) => d.status === "PENDING");
  const { reload } = res;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [pending, reload]);
  return { ...res, items };
}

/** A text field with a live character counter; red when over the limit or empty. */
export function CharField({
  id, label, value, max, rows, hint, readOnly, onChange,
}: { id: string; label: string; value: string; max: number; rows?: number; hint?: string; readOnly?: boolean; onChange: (v: string) => void }) {
  const bad = value.length > max || !value.trim();
  const props = { id, value, readOnly, "aria-invalid": bad, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span className={`tabular-nums text-xs ${bad ? "font-medium text-danger" : "text-muted-foreground"}`}>
          {value.length}/{max}
        </span>
      </div>
      {rows ? <Textarea rows={rows} {...props} /> : <Input {...props} />}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function LocalePicker({ value, onChange, disabled = [] }: { value: Locale[]; onChange: (v: Locale[]) => void; disabled?: Locale[] }) {
  const toggle = (l: Locale) => onChange(value.includes(l) ? value.filter((x) => x !== l) : [...value, l]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Diller</Label>
        <div className="flex gap-2 text-xs">
          <button type="button" className="text-primary hover:underline" onClick={() => onChange([...LOCALES])}>Hepsi</button>
          <button type="button" className="text-primary hover:underline" onClick={() => onChange([])}>Hiçbiri</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LOCALES.map((l) => (
          <label key={l} className={`flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm ${disabled.includes(l) ? "opacity-50" : ""}`}>
            <input type="checkbox" checked={value.includes(l) && !disabled.includes(l)} disabled={disabled.includes(l)} onChange={() => toggle(l)} />
            {LOCALE_LABELS[l]}
          </label>
        ))}
      </div>
    </div>
  );
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(name: string, data: unknown) {
  downloadBlob(name, new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }));
}

export async function downloadDataUrl(name: string, dataUrl: string) {
  downloadBlob(name, await (await fetch(dataUrl)).blob());
}
