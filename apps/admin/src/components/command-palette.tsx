"use client";

import { Building, FileText, Image as ImageIcon, LifeBuoy, Search, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { NAV } from "@/components/app-sidebar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";

// Komut paleti (API.md §7.45; MAEYJA): ⌘K / Ctrl+K from anywhere in the panel. Pages are matched here; users,
// a design by id, support tickets and firms come from GET /admin/search (2+ characters, at most five of each).

type SearchResult = {
  users: Array<{ id: string; email: string | null; name: string | null; role: string; isGuest: boolean; status: string }>;
  designs: Array<{ id: string; userId: string; status: string; tool: string }>;
  tickets: Array<{ id: string; reference: string; subject: string; status: string }>;
  orgs: Array<{ id: string; name: string; status: string }>;
};
type Item = { key: string; group: string; label: string; hint?: string; href: string; icon: React.ComponentType<{ className?: string }> };

const fold = (s: string) => s.toLocaleLowerCase("tr").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<SearchResult | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("casalume:command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("casalume:command-palette", onOpen);
    };
  }, []);

  // Server search, debounced; an older answer never overwrites a newer one.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<SearchResult>("/search", { query: { q: term }, signal: ctrl.signal })
        .then(setFound)
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const term = fold(q.trim());
    const pages = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })))
      .filter((i) => !term || fold(`${i.label} ${i.group}`).includes(term))
      .slice(0, term ? 6 : 8)
      .map((i) => ({ key: `p:${i.href}`, group: "Sayfalar", label: i.label, hint: i.group, href: i.href, icon: i.icon }));
    if (term.length < 2 || !found) return pages;
    return [
      ...pages,
      ...found.users.map((u) => ({ key: `u:${u.id}`, group: "Kullanıcılar", label: u.email ?? u.name ?? "Misafir", hint: [u.role !== "USER" ? u.role : null, u.isGuest ? "misafir" : null, u.status !== "ACTIVE" ? "askıda" : null].filter(Boolean).join(" · "), href: `/users/${u.id}`, icon: UserRound })),
      ...found.designs.map((d) => ({ key: `d:${d.id}`, group: "Tasarımlar", label: `${d.tool} · ${d.status}`, hint: "sahibinin tasarımları", href: `/designs?userId=${d.userId}`, icon: ImageIcon })),
      ...found.tickets.map((t) => ({ key: `t:${t.id}`, group: "Destek", label: `${t.reference} · ${t.subject}`, hint: t.status, href: `/support?t=${t.id}`, icon: LifeBuoy })),
      ...found.orgs.map((o) => ({ key: `o:${o.id}`, group: "Firmalar", label: o.name, hint: o.status !== "ACTIVE" ? "askıda" : undefined, href: `/orgs/${o.id}`, icon: Building })),
    ];
  }, [q, found]);

  const current = Math.min(active, Math.max(0, items.length - 1));

  function go(item: Item | undefined) {
    if (!item) return;
    setOpen(false);
    setQ("");
    setFound(null);
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[current]);
    }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQ("");
          setFound(null);
        }
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Ara</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Sayfa, kullanıcı (e-posta, ad, kimlik), tasarım kimliği, DST-… ya da firma"
            aria-label="Ara"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul ref={listRef} role="listbox" aria-label="Sonuçlar" className="max-h-[60vh] overflow-y-auto p-1.5">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{q.trim().length < 2 ? "Yazmaya başla…" : "Sonuç yok"}</li>}
          {items.map((it, i) => {
            const header = i === 0 || items[i - 1].group !== it.group ? it.group : null;
            const Icon = it.icon;
            return (
              <li key={it.key}>
                {header && <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === current}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(it)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${i === current ? "bg-accent text-accent-foreground" : ""}`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="shrink-0 text-xs text-muted-foreground">{it.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
          <FileText className="h-3.5 w-3.5" aria-hidden /> ↑↓ seç · Enter aç · Esc kapat
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The header's search button: opens the palette (and shows the shortcut). */
export function CommandPaletteButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("casalume:command-palette"))}
      className="ml-auto flex h-8 items-center gap-2 rounded-md border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground"
      aria-label="Ara (⌘K)"
    >
      <Search className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">Ara…</span>
      <kbd className="hidden rounded border px-1 font-mono text-[10px] sm:inline">⌘K</kbd>
    </button>
  );
}
