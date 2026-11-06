"use client";

import { Download, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadMore, PageHeader, Spinner, Table, td, th } from "@/components/common";
import { api, ApiError, useApi, usePaged } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { LOCALE_LABELS, type AdminMe, type Locale, type WaitlistOverview, type WaitlistRow, type WaitlistStatusName } from "@/lib/types";

// Bekleme listesi ve bülten (API.md §7.47): web ziyaretçileri uygulama çıkışı ve yenilikler için e-posta bırakır.
// Çift onay: yalnız onaylanan adres listededir. Onaylanmayan 7 gün, çıkan 30 gün sonra silinir. SUPPORT ve EDITOR
// adresleri maskeli görür; ADMIN adresleri görür, formu açıp kapatır ve KVKK başvurusunda adresi siler. Onaylı
// adreslerin CSV'si yalnız SUPER_ADMIN içindir (Dışa aktarma).

const STATUS: Record<WaitlistStatusName | "all", { label: string; tone: "good" | "warn" | "neutral" }> = {
  all: { label: "Hepsi", tone: "neutral" },
  CONFIRMED: { label: "Onaylı", tone: "good" },
  PENDING: { label: "Onay bekliyor", tone: "warn" },
  UNSUBSCRIBED: { label: "Çıktı", tone: "neutral" },
};
const PLATFORM: Record<string, string> = { ios: "iPhone", android: "Android" };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export default function WaitlistPage() {
  const overview = useApi<WaitlistOverview>("/waitlist/overview");
  const me = useApi<AdminMe>("/me");
  const o = overview.data;
  const isAdmin = me.data ? ["ADMIN", "SUPER_ADMIN"].includes(me.data.role) : false;
  return (
    <>
      <PageHeader
        title="Bekleme listesi ve bülten"
        description="Web ziyaretçileri mobil uygulama çıktığında ve yenilik olduğunda haber almak için e-posta bırakır. Yalnız e-postadaki bağlantıyla onaylanan adres listededir (çift onay); her e-postada listeden çıkma bağlantısı vardır."
        actions={
          me.data?.role === "SUPER_ADMIN" ? (
            <Link href="/exports" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">
              <Download className="h-4 w-4" aria-hidden /> Onaylı adresler (CSV)
            </Link>
          ) : undefined
        }
      />
      {overview.error && !o ? (
        <ErrorState message={overview.error.message} onRetry={overview.reload} />
      ) : !o || !me.data ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Onaylı" value={o.counts.confirmed} hint={`Son 30 günde ${fmtInt(sum(o.daily.map((d) => d.confirmed)))} onay`} />
            <Stat label="Onay bekliyor" value={o.counts.pending} hint="7 gün içinde onaylanmazsa silinir" />
            <Stat label="Listeden çıkan" value={o.counts.unsubscribed} hint="30 gün sonra silinir" />
            <Stat label="Son 7 gün kayıt" value={sum(o.daily.slice(-7).map((d) => d.signups))} hint={`Son 30 gün: ${fmtInt(sum(o.daily.map((d) => d.signups)))}`} />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="Telefon (onaylı)">
              <Bars
                rows={[
                  ["iPhone", o.byPlatform.ios],
                  ["Android", o.byPlatform.android],
                  ["Fark etmez", o.byPlatform.any],
                ]}
              />
            </Card>
            <Card title="Dil (onaylı)">
              {Object.keys(o.byLocale).length === 0 ? (
                <p className="text-sm text-muted-foreground">Henüz onaylı adres yok.</p>
              ) : (
                <Bars rows={Object.entries(o.byLocale).sort((a, b) => b[1] - a[1]).map(([l, n]) => [LOCALE_LABELS[l as Locale] ?? l, n])} />
              )}
            </Card>
            <Settings key={o.version ?? "default"} o={o} canEdit={isAdmin} onSaved={(n) => overview.setData(() => n)} onReload={overview.reload} />
          </div>
          <Entries isAdmin={isAdmin} onChanged={overview.reload} />
        </div>
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtInt(value)}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </Card>
  );
}

function Bars({ rows }: { rows: Array<[string, number]> }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {rows.map(([label, n]) => (
        <li key={label} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2">
          <span className="truncate">{label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(n / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums text-muted-foreground">{fmtInt(n)}</span>
        </li>
      ))}
    </ul>
  );
}

function Settings({ o, canEdit, onSaved, onReload }: { o: WaitlistOverview; canEdit: boolean; onSaved: (o: WaitlistOverview) => void; onReload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [enabled, setEnabled] = useState(o.settings.enabled);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = enabled !== o.settings.enabled;

  async function save() {
    setBusy(true);
    try {
      const out = await api<WaitlistOverview>("/waitlist/settings", { method: "PATCH", body: { settings: { enabled }, reason: reason.trim(), version: o.version } });
      setReason("");
      onSaved(out);
      toast("success", "Kaydedildi. Sitede birkaç dakika içinde görünür.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: "Ayar bu arada değişti", description: "Güncel hâli yüklensin mi?", confirmLabel: "Yükle" })) onReload();
      } else toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  const stores = [
    ["App Store", o.status.stores.ios],
    ["Google Play", o.status.stores.android],
  ] as const;
  return (
    <Card title="Kayıt formu">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" role="switch" checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
        Formu sitede göster (ana sayfa ve alt bilgi)
      </label>
      <p className="mt-2 text-xs text-muted-foreground">Kapalıyken yeni kayıt alınmaz; onay ve çıkış bağlantıları çalışmaya devam eder.</p>
      <ul className="mt-3 flex flex-col gap-1 text-xs">
        {stores.map(([name, url]) => (
          <li key={name} className="flex items-center justify-between gap-2">
            <span>{name}</span>
            {url ? <Badge tone="good">bağlantı var</Badge> : <Badge tone="neutral">yakında</Badge>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Mağaza bağlantıları{" "}
        <Link href="/settings" className="text-primary hover:underline">
          Ayarlar → Uygulama sürümleri
        </Link>{" "}
        bölümünden girilir; girilince ana sayfada indirme düğmesi çıkar.
      </p>
      {canEdit && dirty && (
        <div className="mt-3 flex flex-col gap-2">
          <Field label="Değişiklik gerekçesi" htmlFor="wl-reason">
            <Input id="wl-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button variant="primary" size="sm" className="self-end" loading={busy} disabled={reason.trim().length < 3} onClick={() => void save()}>
            Kaydet
          </Button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {o.updatedAt ? `Son kayıt: ${fmtDateTime(o.updatedAt)}${o.updatedBy ? ` · ${o.updatedBy}` : ""}.` : "Varsayılan: açık."}
      </p>
    </Card>
  );
}

function Entries({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => void }) {
  const { toast } = useFeedback();
  const [status, setStatus] = useState<WaitlistStatusName | "all">("all");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const list = usePaged<WaitlistRow>("/waitlist", { status: status === "all" ? undefined : status, q: term || undefined });
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(r: WaitlistRow) {
    const reason = window.prompt(`${r.email} kalıcı olarak silinsin mi? Neden? (ör. KVKK başvurusu; denetim kaydına yazılır)`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(r.id);
    try {
      await api(`/waitlist/${r.id}/delete`, { method: "POST", body: { reason: reason.trim() } });
      list.setItems((items) => items.filter((x) => x.id !== r.id));
      onChanged();
      toast("success", "Silindi.");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Silinemedi.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title="Adresler"
      actions={
        <div className="flex flex-wrap gap-1">
          {(Object.keys(STATUS) as Array<WaitlistStatusName | "all">).map((s) => (
            <Button key={s} size="sm" variant={s === status ? "primary" : "secondary"} onClick={() => setStatus(s)} aria-pressed={s === status}>
              {STATUS[s].label}
            </Button>
          ))}
        </div>
      }
    >
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(q.trim());
        }}
      >
        <Input aria-label="E-postada ara" placeholder={isAdmin ? "E-postada ara" : "E-postada ara (adresler maskeli)"} value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Button type="submit" size="sm">
          <Search className="h-3.5 w-3.5" aria-hidden /> Ara
        </Button>
      </form>
      {list.error && list.items.length === 0 ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : list.items.length === 0 ? (
        <EmptyState title="Kayıt yok" description="Ana sayfadaki ve alt bilgideki formdan gelen adresler burada görünür." />
      ) : (
        <>
          <Table
            head={
              <tr>
                <th className={th}>E-posta</th>
                <th className={th}>Durum</th>
                <th className={th}>Dil</th>
                <th className={th}>Telefon</th>
                <th className={th}>Kayıt</th>
                <th className={th}>Onay / çıkış</th>
                {isAdmin && <th className={th} />}
              </tr>
            }
          >
            {list.items.map((r) => (
              <tr key={r.id}>
                <td className={`${td} min-w-56 [overflow-wrap:anywhere]`}>
                  {r.email}
                  <span className="block text-[11px] text-muted-foreground">
                    {r.source === "footer" ? "alt bilgi" : "ana sayfa"} · izin metni {r.consentVersion}
                  </span>
                </td>
                <td className={td}>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </td>
                <td className={td}>{LOCALE_LABELS[r.locale as Locale] ?? r.locale}</td>
                <td className={td}>{r.platforms.length ? r.platforms.map((p) => PLATFORM[p] ?? p).join(", ") : "—"}</td>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDateTime(r.createdAt)}</td>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDateTime(r.unsubscribedAt ?? r.confirmedAt)}</td>
                {isAdmin && (
                  <td className={`${td} text-right`}>
                    <Button size="sm" variant="ghost" aria-label={`${r.email}: sil`} loading={busy === r.id} onClick={() => void remove(r)}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </Table>
          <LoadMore hasMore={Boolean(list.nextCursor)} loading={list.loadingMore} onClick={list.loadMore} />
        </>
      )}
    </Card>
  );
}
