"use client";

import { useEffect, useRef, useState } from "react";
import { Crown, ImageUp, Info, LoaderCircle, MousePointerClick, Plus, Sparkles, Undo2, X } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { ImageInputError, fileToUpload } from "@/lib/image";
import { clearStudioPrefill, peekStudioPrefill, type StudioPrefill } from "@/lib/prefill";
import type { CreateDesign, Design, ImageRef, Point, Project, SampleId, Selection, ToolId } from "@/lib/types";
import { useApp, useFeature } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { RoomIcon, ToolIcon } from "@/components/icons";
import { ResultView } from "@/components/result-view";
import { SelectableImage } from "@/components/selectable-image";
import { btn, card, chip, input, label } from "@/components/ui";
import { fmt } from "@/lib/i18n";

const SAMPLES: SampleId[] = ["living_room", "empty_room", "bedroom", "exterior", "garden"];
const CATEGORY_ORDER = ["interior", "exterior", "edit"] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
const LINKABLE_TOOLS = ["redesign", "furnish", "paint", "flooring", "exterior", "garden"] as const;
const MAX_POINTS = 8;

/** One committed tap selection: the taps so far and the mask the server returned for them. */
type SelectionStep = { points: Point[]; mask: string };

function readInitial(): StudioPrefill {
  const prefill = peekStudioPrefill() ?? {};
  const q = new URLSearchParams(window.location.search);
  const style = q.get("style");
  const tool = q.get("tool");
  return {
    ...prefill,
    styleId: prefill.styleId ?? (style && /^[a-z_]{2,40}$/.test(style) ? style : undefined),
    // Landing tiles link straight to a tool (?tool=furnish); anything else is ignored.
    tool: prefill.tool ?? (LINKABLE_TOOLS.find((t) => t === tool) as StudioPrefill["tool"] | undefined),
  };
}

function Section({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2.5 text-sm font-medium uppercase tracking-wide text-muted">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs text-white">{step}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ProgressOverlay({ elapsed }: { elapsed: number }) {
  const { t } = useApp();
  const msg = t.studio.progress[Math.floor(elapsed / 3) % t.studio.progress.length];
  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden rounded-3xl bg-black/45 backdrop-blur-[2px]" role="status" aria-live="polite">
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="relative flex flex-col items-center gap-3 px-6 text-center text-white">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-white/15">
          <Sparkles className="h-7 w-7 animate-pulse" aria-hidden />
        </span>
        <p className="text-base font-medium">{msg}</p>
        <p className="text-xs text-white/80">{fmt(t.studio.elapsed, { s: elapsed })}</p>
      </div>
    </div>
  );
}

export function Studio() {
  const { t, catalog, catalogError, reloadCatalog, user, ensureSession, refreshUser, activeOrg, refreshOrgs } = useApp();
  const feature = useFeature();
  const [initial] = useState(readInitial);

  const [toolId, setToolId] = useState<ToolId>(initial.tool ?? "redesign");
  const [image, setImage] = useState<ImageRef | null>(initial.image ?? null);
  const [styleId, setStyleId] = useState<string | null>(initial.styleId ?? null);
  const [roomId, setRoomId] = useState<string | null>(initial.roomId ?? null);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [colorId, setColorId] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [replacement, setReplacement] = useState("");
  const [instructions, setInstructions] = useState(initial.instructions ?? "");
  const [removeAll, setRemoveAll] = useState(false);
  const [reference, setReference] = useState<ImageRef | null>(null);
  const [variants, setVariants] = useState<1 | 2 | 3 | 4>(2);
  // API.md §7.23 step 4: in a firm workspace a design can go straight into one of the firm's open projects.
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const activeOrgId = activeOrg?.id ?? null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProjectId("");
    if (!activeOrgId) {
      setProjects([]);
      return;
    }
    let alive = true;
    api
      .get<{ items: Project[] }>(`/orgs/${activeOrgId}/projects`)
      .then((r) => alive && setProjects(r.items))
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, [activeOrgId]);

  const [uploading, setUploading] = useState<"input" | "reference" | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Design | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Tap selection (API.md §7.15): a history of steps, so "undo" needs no new (paid) mask request.
  const [steps, setSteps] = useState<SelectionStep[]>([]);
  const [pending, setPending] = useState<Point | null>(null);
  const [selectNote, setSelectNote] = useState<string | null>(null);
  const [tapOff, setTapOff] = useState(false);
  const selSeq = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const refFileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    clearStudioPrefill();
  }, []);

  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  if (!catalog) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {catalogError ? (
          <ErrorNotice error={catalogError} onRetry={reloadCatalog} />
        ) : (
          <p className="flex items-center gap-2 text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {t.common.loading}
          </p>
        )}
      </div>
    );
  }

  const tool = catalog.tools.find((x) => x.id === toolId) ?? catalog.tools[0];
  if (!tool) return null;
  const needs = tool.needs;
  const effStyle = catalog.styles.find((s) => s.id === styleId) ?? catalog.styles[0];
  const effRoom = catalog.rooms.find((r) => r.id === roomId) ?? catalog.rooms[0];
  const effFloor = catalog.floors.find((f) => f.id === floorId) ?? catalog.floors[0];
  const effColor = catalog.colors.find((c) => c.id === colorId) ?? catalog.colors[0];
  const points = steps.at(-1)?.points ?? [];
  // API.md §7.28: tap selection can be switched off; the object is then named instead.
  const canTap = Boolean(needs.points) && !tapOff && feature("tap_selection") && !(needs.removeAll && removeAll);
  const selectHint = t.studio.select.hint[tool.id as keyof typeof t.studio.select.hint] ?? t.studio.select.hint.replace;

  function clearSelection() {
    selSeq.current++;
    setSteps([]);
    setPending(null);
    setSelectNote(null);
  }

  function selectTool(id: ToolId) {
    setToolId(id);
    setError(null);
    clearSelection();
  }

  async function tap(p: Point) {
    if (!image || pending || busy) return;
    if (points.length >= MAX_POINTS) {
      setSelectNote(t.studio.select.max);
      return;
    }
    const next = [...points, p];
    const seq = ++selSeq.current;
    setPending(p);
    setSelectNote(null);
    try {
      await ensureSession();
      const out = await api.post<Selection>(`/uploads/${image.id}/selection`, { points: next });
      if (seq === selSeq.current) setSteps((s) => [...s, { points: next, mask: out.mask }]);
    } catch (e) {
      if (seq !== selSeq.current) return;
      if (e instanceof ApiError && e.code === "selection_unavailable") {
        setTapOff(true);
        setSteps([]);
        setSelectNote(t.studio.select.unavailable);
      } else if (e instanceof ApiError && e.code === "selection_failed") {
        setSelectNote(t.studio.select.notFound);
      } else {
        setError(e);
      }
    } finally {
      if (seq === selSeq.current) setPending(null);
    }
  }

  function undoTap() {
    selSeq.current++;
    setPending(null);
    setSelectNote(null);
    setSteps((s) => s.slice(0, -1));
  }

  async function uploadFile(file: File, kind: "input" | "reference") {
    setError(null);
    setUploading(kind);
    try {
      const payload = await fileToUpload(file);
      await ensureSession();
      const { image: uploaded } = await api.post<{ image: ImageRef }>("/uploads", payload);
      if (kind === "input") {
        setImage(uploaded);
        setResult(null);
        clearSelection();
      } else {
        setReference(uploaded);
      }
    } catch (e) {
      if (e instanceof ImageInputError) {
        setError(new ApiError(400, e.code === "too_large" ? "payload_too_large" : "unsupported_media_type", ""));
      } else {
        setError(e);
      }
    } finally {
      setUploading(null);
    }
  }

  async function pickSample(sample: SampleId) {
    setError(null);
    setUploading("input");
    try {
      await ensureSession();
      const { image: uploaded } = await api.post<{ image: ImageRef }>("/uploads/sample", { sample });
      setImage(uploaded);
      setResult(null);
      clearSelection();
      if (sample === "exterior" && catalog?.tools.some((x) => x.id === "exterior")) setToolId("exterior");
      if (sample === "garden" && catalog?.tools.some((x) => x.id === "garden")) setToolId("garden");
      if (sample === "empty_room" && toolId === "redesign" && catalog?.tools.some((x) => x.id === "furnish")) setToolId("furnish");
    } catch (e) {
      setError(e);
    } finally {
      setUploading(null);
    }
  }

  function validationError(): string | null {
    if (!image) return t.studio.needPhoto;
    if (tool.id === "replace" && needs.target && !target.trim() && !points.length) return t.studio.needTarget;
    if (needs.replacement && !replacement.trim()) return t.studio.needReplacement;
    if (tool.id === "custom" && needs.instructions && !instructions.trim()) return t.studio.needInstructions;
    if (needs.reference && !reference) return t.studio.needReference;
    return null;
  }

  async function generate() {
    const invalid = validationError();
    if (invalid || !image) {
      setError(new ApiError(400, "validation_failed", invalid ?? t.studio.needPhoto));
      return;
    }
    const body: CreateDesign = { tool: tool.id, inputImageId: image.id, variants };
    if (needs.style && effStyle) body.styleId = effStyle.id;
    if (needs.room && effRoom) body.roomId = effRoom.id;
    if (needs.floor && effFloor) body.floorId = effFloor.id;
    if (needs.color && effColor) {
      body.colorHex = effColor.hex;
      body.colorName = effColor.name;
    }
    if (needs.target && target.trim()) body.target = target.trim().slice(0, 120);
    if (needs.replacement && replacement.trim()) body.replacement = replacement.trim().slice(0, 120);
    if (needs.instructions && instructions.trim()) body.instructions = instructions.trim().slice(0, 300);
    if (needs.removeAll) body.removeAll = removeAll;
    if (needs.reference && reference) body.referenceImageId = reference.id;
    if (canTap && points.length) body.points = points;
    if (activeOrg) body.orgId = activeOrg.id; // API.md §7.23: paid by the firm
    if (activeOrg && projectId) body.projectId = projectId;

    setError(null);
    setElapsed(0);
    setBusy(true);
    try {
      await ensureSession();
      const design = await api.post<Design>("/designs", body);
      setResult(design);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      void refreshUser();
      if (activeOrg) void refreshOrgs();
    }
  }

  function reset() {
    setResult(null);
    setError(null);
  }

  const toolsByCategory = CATEGORY_ORDER.map((cat) => ({ cat, tools: catalog.tools.filter((x) => x.category === cat) })).filter(
    (g) => g.tools.length,
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-light sm:text-5xl">{t.studio.title}</h1>
          <p className="mt-1.5 text-muted">{t.studio.subtitle}</p>
        </div>
        {result && (
          <button type="button" onClick={reset} className={`${btn.base} ${btn.ghost} ${btn.md}`}>
            <Plus className="h-4 w-4" aria-hidden /> {t.studio.newDesign}
          </button>
        )}
      </div>

      {initial.fromChat && (
        <p className="mb-6 flex items-center gap-2 rounded-2xl bg-primary-soft p-3.5 text-sm text-primary">
          <Info className="h-4 w-4 shrink-0" aria-hidden /> {t.studio.prefilled}
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[5fr_7fr]">
        {/* Controls */}
        <div className={`${card} space-y-8 p-5 sm:p-6 lg:sticky lg:top-20`}>
          <Section step={1} title={t.studio.stepTool}>
            {toolsByCategory.map((g) => (
              <div key={g.cat}>
                <p className="mb-2 text-xs font-medium text-muted">{t.studio.categories[g.cat]}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">
                  {g.tools.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => selectTool(x.id)}
                      aria-pressed={x.id === tool.id}
                      className={`relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center text-xs font-medium transition ${
                        x.id === tool.id ? "border-primary bg-primary-soft text-primary" : "border-border hover:border-muted/50"
                      }`}
                    >
                      <ToolIcon tool={x.id} className="h-5 w-5" />
                      <span className="leading-tight">{x.name}</span>
                      {(x.isPro || x.isNew) && (
                        <span
                          className={`absolute -right-1 -top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white ${
                            x.isPro ? "bg-accent" : "bg-primary"
                          }`}
                        >
                          {x.isPro ? t.common.pro : t.common.new}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-sm text-muted">{tool.description}</p>
            {tool.isPro && user?.plan !== "PRO" && !activeOrg && (
              <p className="flex items-center gap-1.5 text-xs text-accent">
                <Crown className="h-3.5 w-3.5" aria-hidden /> {t.studio.proHint}
              </p>
            )}
          </Section>

          <Section step={2} title={t.studio.stepPhoto}>
            {image ? (
              <div className="flex items-center gap-3 rounded-2xl border border-border p-2.5">
                <img src={image.url} alt="" className="h-16 w-20 rounded-xl object-cover" />
                <p className="flex-1 text-sm text-muted">
                  {image.width}×{image.height}
                </p>
                <button type="button" onClick={() => fileRef.current?.click()} className={`${btn.base} ${btn.ghost} ${btn.sm}`}>
                  {t.studio.change}
                </button>
              </div>
            ) : (
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void uploadFile(f, "input");
                }}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition ${
                  dragOver ? "border-primary bg-primary-soft" : "border-border hover:border-primary/60"
                }`}
              >
                {uploading === "input" ? (
                  <LoaderCircle className="h-7 w-7 animate-spin text-primary" aria-hidden />
                ) : (
                  <ImageUp className="h-7 w-7 text-primary" aria-hidden />
                )}
                <span className="font-medium">{uploading === "input" ? t.studio.uploading : t.studio.upload}</span>
                <span className="text-xs text-muted">{t.studio.uploadHint}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void uploadFile(f, "input");
                  }}
                />
              </label>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadFile(f, "input");
              }}
            />
            <div>
              <p className="mb-2 text-xs font-medium text-muted">{t.studio.samples}</p>
              <div className="flex flex-wrap gap-2">
                {SAMPLES.map((s) => (
                  <button key={s} type="button" disabled={uploading !== null} onClick={() => pickSample(s)} className={chip(false)}>
                    {t.studio.sampleNames[s]}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section step={3} title={t.studio.stepOptions}>
            <div className="space-y-5">
              {needs.style && (
                <div>
                  <p className={label}>{t.studio.style}</p>
                  <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                    {catalog.styles.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setStyleId(s.id)}
                        aria-pressed={effStyle?.id === s.id}
                        className={`overflow-hidden rounded-2xl border-2 text-left transition ${
                          effStyle?.id === s.id ? "border-primary" : "border-transparent hover:border-border"
                        }`}
                      >
                        <span className="flex h-8">
                          {s.palette.slice(0, 4).map((c, i) => (
                            <span key={`${c}-${i}`} className="flex-1" style={{ background: HEX.test(c) ? c : "#ddd" }} />
                          ))}
                        </span>
                        <span className="flex items-center gap-1 bg-surface-2 px-2 py-1.5 text-xs font-medium">
                          <span className="truncate">{s.name}</span>
                          {s.isPro && <Crown className="h-3 w-3 shrink-0 text-accent" aria-label="PRO" />}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {needs.room && (
                <div>
                  <p className={label}>{t.studio.room}</p>
                  <div className="flex flex-wrap gap-2">
                    {catalog.rooms.map((r) => (
                      <button key={r.id} type="button" onClick={() => setRoomId(r.id)} className={chip(effRoom?.id === r.id)}>
                        <RoomIcon room={r.id} className="h-4 w-4" /> {r.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {needs.floor && (
                <div>
                  <p className={label}>{t.studio.floor}</p>
                  <div className="flex flex-wrap gap-2">
                    {catalog.floors.map((f) => (
                      <button key={f.id} type="button" onClick={() => setFloorId(f.id)} className={chip(effFloor?.id === f.id)}>
                        {f.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {needs.color && (
                <div>
                  <p className={label}>
                    {t.studio.color}
                    {effColor && <span className="ml-2 font-normal text-muted">{effColor.name}</span>}
                  </p>
                  <div className="flex flex-wrap gap-2.5">
                    {catalog.colors.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setColorId(c.id)}
                        title={c.name}
                        aria-label={c.name}
                        aria-pressed={effColor?.id === c.id}
                        className={`h-9 w-9 rounded-full border-2 transition ${
                          effColor?.id === c.id ? "scale-110 border-primary ring-2 ring-primary/30" : "border-border"
                        }`}
                        style={{ background: HEX.test(c.hex) ? c.hex : "#ccc" }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {needs.removeAll && (
                <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={removeAll}
                    onChange={(e) => {
                      setRemoveAll(e.target.checked);
                      if (e.target.checked) clearSelection();
                    }}
                    className="h-5 w-5 accent-[var(--primary)]"
                  />
                  {t.studio.removeAll}
                </label>
              )}

              {needs.target && !(needs.removeAll && removeAll) && (
                <div>
                  <label htmlFor="target" className={label}>
                    {t.studio.target}
                  </label>
                  <input
                    id="target"
                    className={input}
                    maxLength={120}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder={
                      points.length
                        ? t.studio.select.optional
                        : tool.id === "replace"
                          ? t.studio.targetPlaceholderReplace
                          : t.studio.targetPlaceholderDeclutter
                    }
                  />
                  {canTap && <p className="mt-1.5 text-xs text-muted">{t.studio.select.orType}</p>}
                </div>
              )}

              {needs.replacement && (
                <div>
                  <label htmlFor="replacement" className={label}>
                    {t.studio.replacement}
                  </label>
                  <input
                    id="replacement"
                    className={input}
                    maxLength={120}
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                    placeholder={t.studio.replacementPlaceholder}
                  />
                </div>
              )}

              {needs.reference && (
                <div>
                  <p className={label}>{t.studio.reference}</p>
                  {reference ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-border p-2.5">
                      <img src={reference.url} alt="" className="h-14 w-16 rounded-xl object-cover" />
                      <span className="flex-1 text-sm text-muted">{t.studio.reference}</span>
                      <button type="button" onClick={() => setReference(null)} className={`${btn.base} ${btn.subtle} ${btn.icon}`} aria-label={t.common.delete}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => refFileRef.current?.click()}
                      disabled={uploading !== null}
                      className={`${btn.base} ${btn.ghost} ${btn.md} w-full`}
                    >
                      {uploading === "reference" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <ImageUp className="h-4 w-4" aria-hidden />}
                      {t.studio.upload}
                    </button>
                  )}
                  <p className="mt-1.5 text-xs text-muted">{t.studio.referenceHint}</p>
                  <input
                    ref={refFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void uploadFile(f, "reference");
                    }}
                  />
                </div>
              )}

              {needs.instructions && (
                <div>
                  <label htmlFor="instructions" className={label}>
                    {t.studio.instructions}
                  </label>
                  <textarea
                    id="instructions"
                    rows={3}
                    maxLength={300}
                    className={`${input} resize-none`}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder={tool.id === "custom" ? t.studio.customPlaceholder : t.studio.instructionsPlaceholder}
                  />
                </div>
              )}

              <div>
                <p className={label}>{t.studio.variants}</p>
                <div className="inline-grid grid-cols-4 rounded-full bg-surface-2 p-1">
                  {([1, 2, 3, 4] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setVariants(n)}
                      aria-pressed={variants === n}
                      className={`h-9 w-11 rounded-full text-sm font-medium transition ${variants === n ? "bg-surface text-text shadow-card" : "text-muted"}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              {activeOrg && projects.length > 0 && (
                <div>
                  <label htmlFor="studio-project" className={label}>
                    {t.projects.studioProject}
                  </label>
                  <select id="studio-project" className={input} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">{t.projects.noneOption}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.clientName ? `${p.name} · ${p.clientName}` : p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </Section>

          <div className="space-y-3 border-t border-border pt-5">
            {error ? <ErrorNotice error={error} /> : null}
            <button
              type="button"
              onClick={generate}
              disabled={busy || uploading !== null}
              className={`${btn.base} ${btn.primary} ${btn.lg} w-full`}
            >
              {busy ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <Sparkles className="h-5 w-5" aria-hidden />}
              {busy ? t.studio.generating : t.studio.generate}
            </button>
            <p className="text-center text-xs text-muted">
              {fmt(t.studio.cost, { n: variants * (tool.credits ?? 1) })}
              {activeOrg ? (
                activeOrg.remainingThisMonth !== null && <> · {fmt(t.team.pillRemaining, { org: activeOrg.name, n: activeOrg.remainingThisMonth })}</>
              ) : (
                user && user.plan !== "PRO" && <> · {fmt(t.studio.remaining, { free: user.dailyFreeRemaining, credits: user.credits })}</>
              )}
            </p>
            {activeOrg && <p className="text-center text-xs text-primary">{fmt(t.team.studioNote, { org: activeOrg.name })}</p>}
          </div>
        </div>

        {/* Preview / result */}
        <div ref={resultRef} className="scroll-mt-20">
          {result ? (
            <ResultView key={result.id} design={result} onChange={setResult} />
          ) : (
            <div className={`${card} relative overflow-hidden p-2`}>
              {image ? (
                <>
                  {(canTap || selectNote) && (
                    <div className="flex flex-wrap items-center gap-2 px-2 pb-2.5 pt-1 text-sm" aria-live="polite">
                      <MousePointerClick className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      {/* h-9 = the undo/clear buttons, so the photo does not jump when they appear */}
                      <span className="flex min-h-9 flex-1 items-center text-muted">{points.length ? fmt(t.studio.select.count, { n: points.length }) : selectHint}</span>
                      {pending && <LoaderCircle className="h-4 w-4 animate-spin text-primary" aria-hidden />}
                      {points.length > 0 && (
                        <>
                          <button type="button" onClick={undoTap} className={`${btn.base} ${btn.ghost} ${btn.sm}`}>
                            <Undo2 className="h-3.5 w-3.5" aria-hidden /> {t.studio.select.undo}
                          </button>
                          <button type="button" onClick={clearSelection} className={`${btn.base} ${btn.ghost} ${btn.sm}`}>
                            <X className="h-3.5 w-3.5" aria-hidden /> {t.studio.select.clear}
                          </button>
                        </>
                      )}
                      {selectNote && <p className="w-full text-xs text-accent">{selectNote}</p>}
                    </div>
                  )}
                  <SelectableImage
                    src={image.url}
                    alt={canTap ? t.studio.select.imageLabel : t.result.before}
                    width={image.width}
                    height={image.height}
                    enabled={canTap && !busy}
                    points={canTap ? points : []}
                    pending={pending}
                    mask={canTap ? (steps.at(-1)?.mask ?? null) : null}
                    onTap={(p) => void tap(p)}
                  >
                    {busy && <ProgressOverlay elapsed={elapsed} />}
                  </SelectableImage>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="grid aspect-[4/3] w-full place-items-center rounded-3xl bg-surface-2 text-muted transition hover:text-primary"
                >
                  <span className="flex flex-col items-center gap-3 px-6 text-center">
                    <ImageUp className="h-10 w-10" aria-hidden />
                    <span className="font-medium">{t.studio.needPhoto}</span>
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
