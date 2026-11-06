"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  LayoutGrid,
  List,
  Maximize2,
  MoreHorizontal,
  Search,
  Star,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Compare, Img, NoResult } from "@/components/design-media";
import { EmptyState, ErrorState, LoadMore, PageHeader } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError, useApi, usePaged } from "@/lib/api";
import { fmtDateTime, STATUS_LABELS, TOOL_LABELS, toolLabel } from "@/lib/format";
import type { AdminDesign, AdminMe, AdminStyle, Design } from "@/lib/types";

type View = "grid" | "list";
type Tab = "all" | "featured" | "shareable" | Design["status"];

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "SUCCEEDED", label: STATUS_LABELS.SUCCEEDED },
  { value: "FAILED", label: STATUS_LABELS.FAILED },
  { value: "PENDING", label: STATUS_LABELS.PENDING },
  { value: "featured", label: "Öne çıkanlar" },
  { value: "shareable", label: "Paylaşım izni olanlar" },
];
/** API.md §7.51: only a successful design whose owner allowed the gallery can be featured. */
const featureBlock = (d: Design) =>
  d.featured ? null : d.status !== "SUCCEEDED" ? "Yalnız başarılı tasarımlar öne çıkarılabilir" : !d.shareable ? "Kullanıcı galeride paylaşılmasına izin vermedi" : null;
const ALL = "all";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_STYLE: Record<Design["status"], { className: string; icon: typeof CheckCircle2 }> = {
  SUCCEEDED: { className: "text-good", icon: CheckCircle2 },
  FAILED: { className: "text-danger", icon: AlertTriangle },
  PENDING: { className: "text-warn", icon: Clock },
};

const titleOf = (d: Design) => d.title || toolLabel(d.tool);

export function DesignsView({ initialUserId }: { initialUserId: string }) {
  const [tab, setTab] = useState<Tab>("all");
  const [tool, setTool] = useState(ALL);
  const [styleId, setStyleId] = useState(ALL);
  const [userIdInput, setUserIdInput] = useState(initialUserId);
  const [userId, setUserId] = useState(initialUserId.trim());
  const [view, setView] = useState<View>("grid");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setUserId(userIdInput.trim()), 400);
    return () => clearTimeout(t);
  }, [userIdInput]);

  // The API takes a full user id only; a half-typed one would just come back as a 400.
  const userIdValid = UUID_RE.test(userId);
  const designs = usePaged<AdminDesign>("/designs", {
    status: tab === "all" || tab === "featured" || tab === "shareable" ? "" : tab,
    featured: tab === "featured" ? "true" : "",
    shareable: tab === "shareable" ? "true" : "",
    tool: tool === ALL ? "" : tool,
    styleId: styleId === ALL ? "" : styleId,
    userId: userIdValid ? userId : "",
  });
  const styles = useApi<AdminStyle[]>("/styles");
  const me = useApi<AdminMe>("/me");
  const { toast, confirm } = useFeedback();
  const [busyId, setBusyId] = useState<string | null>(null);

  const role = me.data?.role;
  const canFeature = role === "EDITOR" || role === "ADMIN" || role === "SUPER_ADMIN";
  const canDelete = role === "ADMIN" || role === "SUPER_ADMIN";
  const styleName = (id: string | null) => (id ? (styles.data?.find((s) => s.id === id)?.nameTr ?? id) : undefined);
  const filtered = tab !== "all" || tool !== ALL || styleId !== ALL || Boolean(userIdInput.trim());
  const selected = designs.items.find((d) => d.id === selectedId) ?? null;

  function clearFilters() {
    setTab("all");
    setTool(ALL);
    setStyleId(ALL);
    setUserIdInput("");
  }

  async function toggleFeatured(d: AdminDesign) {
    setBusyId(d.id);
    try {
      const updated = await api<Design>(`/designs/${encodeURIComponent(d.id)}`, { method: "PATCH", body: { featured: !d.featured } });
      designs.setItems((items) => items.map((x) => (x.id === d.id ? { ...x, ...updated } : x)));
      toast("success", updated.featured ? "İlham galerisinde öne çıkarıldı." : "Öne çıkarma kaldırıldı.");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem başarısız.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(d: AdminDesign) {
    const ok = await confirm({
      title: "Tasarım silinsin mi?",
      description: "Tasarım ve üretilen görseller kalıcı olarak silinir. Bu işlem denetim kaydına yazılır ve geri alınamaz.",
      confirmLabel: "Sil",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(d.id);
    try {
      await api<void>(`/designs/${encodeURIComponent(d.id)}`, { method: "DELETE" });
      designs.setItems((items) => items.filter((x) => x.id !== d.id));
      setSelectedId((id) => (id === d.id ? null : id));
      toast("success", "Tasarım silindi.");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Silme başarısız.");
    } finally {
      setBusyId(null);
    }
  }

  const actionsFor = (d: AdminDesign) => (
    <DesignActions
      design={d}
      busy={busyId === d.id}
      canFeature={canFeature}
      canDelete={canDelete}
      onOpen={() => setSelectedId(d.id)}
      onFeature={() => toggleFeatured(d)}
      onUserFilter={() => setUserIdInput(d.userId)}
      onDelete={() => remove(d)}
    />
  );

  return (
    <>
      <PageHeader title="Tasarımlar" description="Tüm üretimler; moderasyon ve ilham galerisi seçimi. Galeride yalnız sahibinin izin verdiği tasarım öne çıkarılabilir; izin geri çekilince tasarım galeriden kendiliğinden kalkar." />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={tab} onValueChange={(v) => v && setTab(v as Tab)} aria-label="Durum">
          {TABS.map((t) => (
            <ToggleGroupItem key={t.value} value={t.value} className="px-3">
              {t.value === "featured" && <Star aria-hidden />}
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as View)} aria-label="Görünüm" className="ml-auto">
          <ToggleGroupItem value="grid" aria-label="Izgara">
            <LayoutGrid aria-hidden />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="Liste">
            <List aria-hidden />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Select value={tool} onValueChange={setTool}>
          <SelectTrigger size="sm" className="w-44" aria-label="Araç">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tüm araçlar</SelectItem>
            {Object.entries(TOOL_LABELS).map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={styleId} onValueChange={setStyleId}>
          <SelectTrigger size="sm" className="w-44" aria-label="Stil">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tüm stiller</SelectItem>
            {styles.data?.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nameTr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Kullanıcı kimliği"
            aria-invalid={Boolean(userId) && !userIdValid}
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            placeholder="Kullanıcı kimliği (UUID)"
            className="h-8 pl-8 font-mono text-xs"
          />
        </div>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X aria-hidden /> Filtreleri temizle
          </Button>
        )}
        {Boolean(userId) && !userIdValid && <p className="w-full text-xs text-danger">Tam kullanıcı kimliğini gir; kullanıcı sayfasındaki “Tasarımlar” bağlantısı bunu doldurur.</p>}
      </div>

      {designs.error && designs.items.length === 0 ? (
        <ErrorState message={designs.error.message} onRetry={designs.reload} />
      ) : designs.loading && designs.items.length === 0 ? (
        <GridSkeleton />
      ) : designs.items.length === 0 ? (
        <EmptyState
          title={tab === "featured" ? "Öne çıkan tasarım yok" : tab === "shareable" ? "Galeri izni verilmiş tasarım yok" : "Tasarım bulunamadı"}
          description={filtered ? "Filtreleri değiştirip tekrar dene." : "Kullanıcılar henüz tasarım üretmedi."}
        />
      ) : (
        <div className={designs.loading ? "opacity-60 transition-opacity" : undefined}>
          {view === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {designs.items.map((d) => (
                <VaultCard key={d.id} design={d} styleName={styleName(d.styleId)} onOpen={() => setSelectedId(d.id)} actions={actionsFor(d)} />
              ))}
            </div>
          ) : (
            <VaultTable designs={designs.items} styleName={styleName} onOpen={setSelectedId} actionsFor={actionsFor} />
          )}
          {designs.error && <p className="pt-3 text-sm text-danger">{designs.error.message}</p>}
          <LoadMore hasMore={Boolean(designs.nextCursor)} loading={designs.loadingMore} onClick={designs.loadMore} />
        </div>
      )}

      <DetailSheet
        design={selected}
        styleName={selected ? styleName(selected.styleId) : undefined}
        busy={selected ? busyId === selected.id : false}
        canFeature={canFeature}
        canDelete={canDelete}
        onClose={() => setSelectedId(null)}
        onFeature={() => selected && toggleFeatured(selected)}
        onDelete={() => selected && remove(selected)}
      />
    </>
  );
}

function StatusBadge({ status, overlay }: { status: Design["status"]; overlay?: boolean }) {
  const { className, icon: Icon } = STATUS_STYLE[status];
  return (
    <Badge variant="outline" className={`${className} ${overlay ? "border-transparent bg-background/90 shadow-sm backdrop-blur" : ""}`}>
      <Icon aria-hidden /> {STATUS_LABELS[status]}
    </Badge>
  );
}

function VaultCard({ design: d, styleName, onOpen, actions }: { design: AdminDesign; styleName?: string; onOpen: () => void; actions: ReactNode }) {
  const result = d.results[0];
  return (
    <Card className="group gap-0 overflow-hidden py-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${titleOf(d)} ayrıntıları`}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {result ? (
          <Img src={result.url} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <NoResult status={d.status} />
        )}
        {d.input && (
          <Img src={d.input.url} alt="" className="absolute bottom-2 left-2 h-12 w-16 rounded-md border-2 border-background object-cover shadow-md" />
        )}
        <span className="absolute top-2 left-2">
          <StatusBadge status={d.status} overlay />
        </span>
        {d.featured && (
          <span className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-background/90 text-warn shadow-sm" title="Öne çıkan">
            <Star className="size-3.5" fill="currentColor" aria-label="Öne çıkan" />
          </span>
        )}
        {d.results.length > 1 && (
          <span className="absolute right-2 bottom-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium shadow-sm">{d.results.length} varyant</span>
        )}
      </button>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{titleOf(d)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {toolLabel(d.tool)}
            {styleName ? ` · ${styleName}` : ""}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {d.userEmail ?? "Misafir kullanıcı"} · {fmtDateTime(d.createdAt)}
          </p>
        </div>
        {actions}
      </div>
    </Card>
  );
}

function VaultTable({
  designs,
  styleName,
  onOpen,
  actionsFor,
}: {
  designs: AdminDesign[];
  styleName: (id: string | null) => string | undefined;
  onOpen: (id: string) => void;
  actionsFor: (d: AdminDesign) => ReactNode;
}) {
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24 pl-4">Görsel</TableHead>
            <TableHead>Tasarım</TableHead>
            <TableHead>Kullanıcı</TableHead>
            <TableHead>Durum</TableHead>
            <TableHead>Tarih</TableHead>
            <TableHead className="w-12 pr-4">
              <span className="sr-only">İşlemler</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {designs.map((d) => {
            const thumb = d.results[0] ?? d.input;
            return (
              <TableRow key={d.id} className="cursor-pointer" onClick={() => onOpen(d.id)}>
                <TableCell className="pl-4">
                  <div className="h-12 w-16 overflow-hidden rounded-md bg-muted">{thumb && <Img src={thumb.url} alt="" className="size-full object-cover" />}</div>
                </TableCell>
                <TableCell>
                  <button type="button" className="text-left" onClick={() => onOpen(d.id)}>
                    <span className="flex items-center gap-1.5 font-medium">
                      {titleOf(d)}
                      {d.featured && <Star className="size-3.5 text-warn" fill="currentColor" aria-label="Öne çıkan" />}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {toolLabel(d.tool)}
                      {styleName(d.styleId) ? ` · ${styleName(d.styleId)}` : ""}
                      {d.results.length > 1 ? ` · ${d.results.length} varyant` : ""}
                    </span>
                  </button>
                </TableCell>
                <TableCell className="max-w-56 truncate text-muted-foreground">{d.userEmail ?? "Misafir kullanıcı"}</TableCell>
                <TableCell>
                  <StatusBadge status={d.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateTime(d.createdAt)}</TableCell>
                <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                  {actionsFor(d)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function DesignActions({
  design: d,
  busy,
  canFeature,
  canDelete,
  onOpen,
  onFeature,
  onUserFilter,
  onDelete,
}: {
  design: AdminDesign;
  busy: boolean;
  canFeature: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onFeature: () => void;
  onUserFilter: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" disabled={busy} aria-label={`${titleOf(d)} işlemleri`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={onOpen}>
          <Maximize2 aria-hidden /> Ayrıntılar
        </DropdownMenuItem>
        {canFeature && (
          <DropdownMenuItem onSelect={onFeature} disabled={featureBlock(d) !== null} title={featureBlock(d) ?? undefined}>
            <Star aria-hidden /> {d.featured ? "Öne çıkarmayı kaldır" : d.shareable ? "Öne çıkar" : "Öne çıkar (izin yok)"}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onUserFilter}>
          <Search aria-hidden /> Bu kullanıcının tasarımları
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/users/${encodeURIComponent(d.userId)}`}>
            <UserRound aria-hidden /> Kullanıcı sayfası
          </Link>
        </DropdownMenuItem>
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 aria-hidden /> Sil
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DetailSheet({
  design: d,
  styleName,
  busy,
  canFeature,
  canDelete,
  onClose,
  onFeature,
  onDelete,
}: {
  design: AdminDesign | null;
  styleName?: string;
  busy: boolean;
  canFeature: boolean;
  canDelete: boolean;
  onClose: () => void;
  onFeature: () => void;
  onDelete: () => void;
}) {
  const [variant, setVariant] = useState(0);
  const [shownId, setShownId] = useState<string | null>(null);
  // A different design starts from its first variant (state reset during render, not in an effect).
  if (d && d.id !== shownId) {
    setShownId(d.id);
    setVariant(0);
  }
  const result = d?.results[Math.min(variant, (d?.results.length ?? 1) - 1)];
  const params = d ? Object.entries(d.params ?? {}).filter(([, v]) => v !== null && v !== "" && typeof v !== "object") : [];

  return (
    <Sheet open={Boolean(d)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {d && (
          <>
            <SheetHeader className="border-b pr-12">
              <SheetTitle>{titleOf(d)}</SheetTitle>
              <SheetDescription>
                {toolLabel(d.tool)}
                {styleName ? ` · ${styleName}` : ""} · {fmtDateTime(d.createdAt)}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 p-4">
              {result && d.input ? (
                <Compare before={d.input} after={result} />
              ) : (
                <div className="aspect-[4/3] overflow-hidden rounded-lg bg-muted">
                  {d.input ? <Img src={d.input.url} alt="Yüklenen fotoğraf" className="size-full object-cover" /> : <NoResult status={d.status} />}
                </div>
              )}

              {d.results.length > 1 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Varyantlar">
                  {d.results.map((r, i) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setVariant(i)}
                      aria-pressed={i === variant}
                      aria-label={`Varyant ${i + 1}`}
                      className={`h-14 w-20 overflow-hidden rounded-md border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring ${i === variant ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"}`}
                    >
                      <Img src={r.url} alt="" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {d.status === "FAILED" && d.error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{d.error}</p>}

              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2.5 text-sm">
                <dt className="text-muted-foreground">Durum</dt>
                <dd className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={d.status} />
                  {d.featured && (
                    <Badge variant="outline" className="text-warn">
                      <Star fill="currentColor" aria-hidden /> Öne çıkan
                    </Badge>
                  )}
                </dd>
                <dt className="text-muted-foreground">Galeri izni</dt>
                <dd>{d.shareable ? <span className="text-good">Kullanıcı izin verdi</span> : <span className="text-muted-foreground">İzin yok</span>}</dd>
                <dt className="text-muted-foreground">Kullanıcı</dt>
                <dd className="min-w-0 truncate">
                  <Link href={`/users/${encodeURIComponent(d.userId)}`} className="text-primary hover:underline">
                    {d.userEmail ?? "Misafir kullanıcı"}
                  </Link>
                </dd>
                <dt className="text-muted-foreground">Araç</dt>
                <dd>{toolLabel(d.tool)}</dd>
                {styleName && (
                  <>
                    <dt className="text-muted-foreground">Stil</dt>
                    <dd>{styleName}</dd>
                  </>
                )}
                {params.map(([k, v]) => (
                  <Param key={k} name={k} value={typeof v === "boolean" ? (v ? "Evet" : "Hayır") : String(v)} />
                ))}
                <dt className="text-muted-foreground">Kimlik</dt>
                <dd className="font-mono text-xs break-all select-all">{d.id}</dd>
              </dl>
            </div>

            {(canFeature || canDelete) && (
              <SheetFooter className="sticky bottom-0 mt-auto flex-row flex-wrap border-t bg-background">
                {canFeature && (
                  <Button
                    variant={d.featured ? "secondary" : "default"}
                    onClick={onFeature}
                    disabled={busy || featureBlock(d) !== null}
                    title={featureBlock(d) ?? undefined}
                  >
                    <Star fill={d.featured ? "currentColor" : "none"} aria-hidden />
                    {d.featured ? "Öne çıkarmayı kaldır" : "İlham galerisinde öne çıkar"}
                  </Button>
                )}
                {canDelete && (
                  <Button variant="outline" className="text-destructive" onClick={onDelete} disabled={busy}>
                    <Trash2 aria-hidden /> Sil
                  </Button>
                )}
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Keys the backend stores per tool (designs.service); anything else falls back to its raw name.
const PARAM_LABELS: Record<string, string> = {
  variants: "Varyant sayısı",
  floorId: "Zemin",
  colorName: "Renk",
  colorHex: "Renk kodu",
  target: "Hedef nesne",
  replacement: "Yerine",
  instructions: "Talimat",
  removeAll: "Hepsini kaldır",
  referenceImageId: "Referans görsel",
};

function Param({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="truncate text-muted-foreground">{PARAM_LABELS[name] ?? name}</dt>
      <dd className="break-words">{value}</dd>
    </>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy="true" aria-label="Yükleniyor">
      {Array.from({ length: 8 }, (_, i) => (
        <Card key={i} className="gap-0 overflow-hidden py-0">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  );
}
