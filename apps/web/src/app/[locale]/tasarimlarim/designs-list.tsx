"use client";

import Link from "@/components/locale-link";
import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Heart, ImageOff, LoaderCircle, Plus, Trash2, Users } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Design, Page, Project } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { ToolIcon } from "@/components/icons";
import { btn, input } from "@/components/ui";
import { fmt } from "@/lib/i18n";

export function DesignsList() {
  const { t, locale, user, userReady, activeOrg } = useApp();
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  // API.md §7.23 step 4: in a firm workspace, "my designs" or one shared project (everyone's designs in it).
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<string | null>(null);
  const orgId = activeOrg?.id ?? null;
  const loadProjects = useCallback(() => {
    if (!orgId) return setProjects([]);
    api
      .get<{ items: Project[] }>(`/orgs/${orgId}/projects`)
      .then((r) => setProjects(r.items))
      .catch(() => setProjects([]));
  }, [orgId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(null);
    loadProjects();
  }, [loadProjects]);
  const [items, setItems] = useState<Design[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const [reloadKey, setReloadKey] = useState(0);

  const fetchPage = useCallback(
    (after: string | null) => {
      const qs = new URLSearchParams({ limit: "24" });
      if (after) qs.set("cursor", after);
      if (filter === "favorites" && !view) qs.set("favorite", "true");
      if (orgId) qs.set("orgId", orgId); // API.md §7.23: one workspace at a time
      if (orgId && view) qs.set("projectId", view);
      return api.get<Page<Design>>(`/designs?${qs}`);
    },
    [filter, orgId, view],
  );

  useEffect(() => {
    if (!userReady) return;
    let alive = true;
    fetchPage(null)
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) {
          setItems([]);
          setCursor(null);
        } else {
          setError(e);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [fetchPage, userReady, user?.id, reloadKey]);

  function changeFilter(f: "all" | "favorites") {
    if (f === filter) return;
    setFilter(f);
    setItems([]);
    setCursor(null);
    setError(null);
    setLoading(true);
  }

  function retry() {
    setError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await fetchPage(cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  async function toggleFavorite(d: Design) {
    try {
      const updated = await api.patch<Design>(`/designs/${d.id}`, { favorite: !d.favorite });
      setItems((prev) =>
        filter === "favorites" && !updated.favorite ? prev.filter((x) => x.id !== d.id) : prev.map((x) => (x.id === d.id ? updated : x)),
      );
    } catch (e) {
      setError(e);
    }
  }

  async function moveTo(d: Design, projectId: string | null) {
    try {
      const updated = await api.patch<Design>(`/designs/${d.id}`, { projectId });
      setItems((prev) => (view && updated.projectId !== view ? prev.filter((x) => x.id !== d.id) : prev.map((x) => (x.id === d.id ? updated : x))));
      loadProjects();
    } catch (e) {
      setError(e);
    }
  }

  async function remove(d: Design) {
    if (!window.confirm(t.designs.deleteConfirm)) return;
    try {
      await api.del(`/designs/${d.id}`);
      setItems((prev) => prev.filter((x) => x.id !== d.id));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-4xl font-display font-light sm:text-5xl">{t.designs.title}</h1>
        <div className="flex items-center gap-2">
          {!view && (
            <div className="inline-grid grid-cols-2 rounded-full bg-surface-2 p-1">
              {(["all", "favorites"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => changeFilter(f)}
                  aria-pressed={filter === f}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium ${filter === f ? "bg-surface shadow-card" : "text-muted"}`}
                >
                  {f === "all" ? t.common.all : t.common.favorites}
                </button>
              ))}
            </div>
          )}
          <Link href="/studio" className={`${btn.base} ${btn.primary} ${btn.sm}`}>
            <Plus className="h-4 w-4" aria-hidden /> {t.studio.newDesign}
          </Link>
        </div>
      </div>

      {orgId && (
        <ProjectBar
          projects={projects}
          view={view}
          onView={(v) => {
            setView(v);
            setItems([]);
            setCursor(null);
            setLoading(true);
          }}
          onCreated={(p) => {
            setProjects((prev) => [p, ...prev]);
          }}
          orgId={orgId}
          onError={setError}
        />
      )}

      {error ? (
        <div className="mb-6">
          <ErrorNotice error={error} onRetry={retry} />
        </div>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border px-6 py-16 text-center">
          <ImageOff className="h-10 w-10 text-muted" aria-hidden />
          <p className="text-muted">{view ? t.projects.emptyProject : t.designs.empty}</p>
          <Link href="/studio" className={`${btn.base} ${btn.primary} ${btn.md}`}>
            {t.designs.emptyCta}
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((d) => {
            const cover = d.results[0] ?? d.input;
            return (
              <article key={d.id} className="group overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
                <Link href={`/tasarim/${d.id}`} className="relative block aspect-[4/3] overflow-hidden bg-surface-2">
                  <img src={cover.url} alt={d.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                  {d.status === "FAILED" && (
                    <span className="absolute left-3 top-3 rounded-full bg-danger px-2.5 py-1 text-xs font-medium text-white">{t.designs.failed}</span>
                  )}
                  {d.results.length > 1 && (
                    <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
                      {d.results.length} {t.result.variantCount}
                    </span>
                  )}
                </Link>
                <div className="flex items-center gap-2 p-4">
                  <ToolIcon tool={d.tool} className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/tasarim/${d.id}`} className="block truncate font-medium hover:text-primary">
                      {d.title}
                    </Link>
                    <p className="text-xs text-muted">{formatDate(d.createdAt, locale)}</p>
                  </div>
                  {d.mine === false ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
                      <Users className="h-3.5 w-3.5" aria-hidden /> {t.projects.fromTeam}
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleFavorite(d)}
                        className={`${btn.base} ${btn.subtle} ${btn.icon}`}
                        aria-pressed={d.favorite}
                        aria-label={d.favorite ? t.result.unfavorite : t.result.favorite}
                      >
                        <Heart className={`h-4 w-4 ${d.favorite ? "fill-accent text-accent" : ""}`} />
                      </button>
                      <button type="button" onClick={() => remove(d)} className={`${btn.base} ${btn.subtle} ${btn.icon}`} aria-label={t.common.delete}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
                {orgId && d.mine !== false && projects.length > 0 && (
                  <div className="border-t border-border px-4 py-2">
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="sr-only">{t.projects.moveTo}</span>
                      <select
                        className="min-w-0 flex-1 truncate bg-transparent py-1 text-xs text-text outline-none"
                        value={d.projectId ?? ""}
                        onChange={(e) => moveTo(d, e.target.value || null)}
                        aria-label={t.projects.moveTo}
                      >
                        <option value="">{t.projects.noneOption}</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </article>
            );
          })}
          {loading &&
            Array.from({ length: items.length ? 3 : 6 }, (_, i) => <div key={`s${i}`} className="aspect-[4/3.6] animate-pulse rounded-3xl bg-surface-2" />)}
        </div>
      )}

      {cursor && !loading && (
        <div className="mt-8 text-center">
          <button type="button" onClick={loadMore} className={`${btn.base} ${btn.ghost} ${btn.md}`}>
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} {t.common.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}

/** API.md §7.23 step 4: "My designs" and the firm's open projects, plus a small form to open a new one. */
function ProjectBar({
  projects,
  view,
  onView,
  onCreated,
  orgId,
  onError,
}: {
  projects: Project[];
  view: string | null;
  onView: (v: string | null) => void;
  onCreated: (p: Project) => void;
  orgId: string;
  onError: (e: unknown) => void;
}) {
  const { t } = useApp();
  const s = t.projects;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  const chipCls = (active: boolean) =>
    `inline-flex max-w-60 items-center gap-1.5 truncate rounded-full border px-3.5 py-1.5 text-sm transition ${active ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface hover:bg-surface-2"}`;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api.post<Project>(`/orgs/${orgId}/projects`, { name: name.trim(), clientName: client.trim() || null });
      onCreated(p);
      onView(p.id);
      setName("");
      setClient("");
      setOpen(false);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chipCls(view === null)} onClick={() => onView(null)} aria-pressed={view === null}>
          {s.mine}
        </button>
        {projects.map((p) => (
          <button key={p.id} type="button" className={chipCls(view === p.id)} onClick={() => onView(p.id)} aria-pressed={view === p.id} title={p.clientName ?? undefined}>
            <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{p.name}</span>
            <span className="text-xs text-muted">{p.designs}</span>
          </button>
        ))}
        <button type="button" className={`${btn.base} ${btn.ghost} ${btn.sm}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Plus className="h-4 w-4" aria-hidden /> {s.newProject}
        </button>
      </div>
      {open && (
        <form onSubmit={create} className="mt-3 flex flex-wrap items-end gap-2">
          <input aria-label={s.name} placeholder={s.name} className={`${input} max-w-xs`} required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label={s.client} placeholder={s.client} className={`${input} max-w-xs`} maxLength={80} value={client} onChange={(e) => setClient(e.target.value)} />
          <button type="submit" className={`${btn.base} ${btn.primary} ${btn.md}`} disabled={busy || name.trim().length < 2}>
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />} {s.create}
          </button>
        </form>
      )}
      <p className="mt-3 text-xs text-muted">{view ? fmt(s.designsCount, { n: projects.find((p) => p.id === view)?.designs ?? 0 }) + " · " : ""}{s.shared}</p>
    </div>
  );
}
