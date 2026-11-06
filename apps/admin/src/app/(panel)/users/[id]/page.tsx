"use client";

import { ArrowLeft, Ban, CalendarClock, CircleCheck, Coins, Crown, Gift, ImageIcon, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { DesignCard } from "@/components/design-card";
import { EmptyState, ErrorState, Spinner } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { ReasonDialog } from "@/components/reason-dialog";
import { Section } from "@/components/section";
import { badgeTone, StatCard } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminMe, AdminStyle, AdminUser, AdminUserDetail, AdminUserSessions } from "@/lib/types";

// Kullanıcı detayı: özet, plan, kredi düzeltme, hediye (API.md §7.31), mağaza abonelikleri, kredi hareketleri,
// son tasarımlar, açık oturumlar ve giriş denemeleri (§7.37). SUPPORT okur; değişiklikler ADMIN ve üstü.

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

const canWrite = (me: AdminMe | null) => me?.role === "ADMIN" || me?.role === "SUPER_ADMIN";
const Spin = ({ on }: { on: boolean }) => (on ? <Loader2 className="animate-spin" aria-hidden /> : null);

const SUB_STATUS: Record<string, { label: string; className: string }> = {
  active: { label: "Aktif", className: badgeTone.good },
  cancelled: { label: "İptal etti", className: badgeTone.warn },
  grace: { label: "Ek süre", className: badgeTone.warn },
  billing_issue: { label: "Ödeme sorunu", className: badgeTone.danger },
  expired: { label: "Süresi doldu", className: badgeTone.neutral },
};
const STORES: Record<string, string> = { APP_STORE: "App Store", PLAY_STORE: "Google Play", MAC_APP_STORE: "Mac App Store", STRIPE: "Stripe", PROMOTIONAL: "Promosyon", AMAZON: "Amazon" };

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi<AdminUserDetail>(id ? `/users/${encodeURIComponent(id)}` : null);
  const styles = useApi<AdminStyle[]>("/styles");
  const me = useApi<AdminMe>("/me");
  const writable = canWrite(me.data);
  const { toast, confirm } = useFeedback();
  const user = detail.data;

  const [busy, setBusy] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<{ plan: "FREE" | "PRO"; expires: string } | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [gift, setGift] = useState({ credits: "5", message: "", email: false, reason: "" });

  const plan = planDraft ?? (user ? { plan: user.plan, expires: toDateInput(user.planExpiresAt) } : { plan: "FREE" as const, expires: "" });

  function mergeUser(updated: AdminUser) {
    detail.setData((prev) => (prev ? { ...prev, ...updated } : prev));
  }

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem başarısız.");
    } finally {
      setBusy(null);
    }
  }

  /** API.md §7.31: a gift the user sees (push, optional e-mail); the reason stays in the audit log. */
  async function sendGift(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const n = Number(gift.credits);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      toast("error", "Hediye 1–500 kredi olmalı.");
      return;
    }
    const ok = await confirm({
      title: `${fmtInt(n)} kredi hediye edilsin mi?`,
      description: `Kullanıcıya push bildirimi gider${gift.email ? " ve e-posta gönderilir" : ""}.${gift.message.trim() ? ` Mesaj: “${gift.message.trim()}”` : ""}`,
      confirmLabel: "Gönder",
    });
    if (!ok) return;
    await run("gift", async () => {
      const out = await api<{ credits: number; pushed: number; emailed: boolean }>(`/users/${encodeURIComponent(user.id)}/gift`, {
        method: "POST",
        body: { credits: n, message: gift.message.trim(), email: gift.email, reason: gift.reason.trim() },
      });
      setGift({ credits: "5", message: "", email: false, reason: "" });
      detail.reload();
      toast("success", `Hediye gönderildi · ${out.pushed ? `${out.pushed} cihaza bildirim` : "bildirim yok (uygulama yok)"}${out.emailed ? " · e-posta gitti" : ""}.`);
    });
  }

  async function toggleBan() {
    if (!user) return;
    const banning = user.status === "ACTIVE";
    const ok = await confirm({
      title: banning ? "Kullanıcı engellensin mi?" : "Engel kaldırılsın mı?",
      description: banning ? "Kullanıcı uygulamaya giriş yapamaz, açık oturumları kapanır ve yeni tasarım üretemez." : "Kullanıcı tekrar uygulamayı kullanabilir.",
      confirmLabel: banning ? "Engelle" : "Engeli kaldır",
      destructive: banning,
    });
    if (!ok) return;
    await run("status", async () => {
      mergeUser(await api<AdminUser>(`/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: { status: banning ? "BANNED" : "ACTIVE" } }));
      toast("success", banning ? "Kullanıcı engellendi." : "Engel kaldırıldı.");
    });
  }

  async function savePlan(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const planExpiresAt = plan.plan === "PRO" && plan.expires ? new Date(`${plan.expires}T23:59:59`).toISOString() : null;
    await run("plan", async () => {
      mergeUser(await api<AdminUser>(`/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: { plan: plan.plan, planExpiresAt } }));
      setPlanDraft(null);
      toast("success", "Plan güncellendi.");
    });
  }

  async function adjustCredits(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const n = Number(delta);
    const why = reason.trim();
    if (!Number.isInteger(n) || n === 0 || n < -1000 || n > 1000) {
      toast("error", "Kredi değişimi −1000 ile 1000 arasında, sıfırdan farklı bir tam sayı olmalı.");
      return;
    }
    if (why.length < 3 || why.length > 200) {
      toast("error", "Açıklama 3–200 karakter olmalı.");
      return;
    }
    const ok = await confirm({
      title: n > 0 ? `${fmtInt(n)} kredi eklensin mi?` : `${fmtInt(Math.abs(n))} kredi düşülsün mü?`,
      description: `Gerekçe: ${why}`,
      confirmLabel: "Uygula",
      destructive: n < 0,
    });
    if (!ok) return;
    await run("credits", async () => {
      mergeUser(await api<AdminUser>(`/users/${encodeURIComponent(user.id)}/credits`, { method: "POST", body: { delta: n, reason: why } }));
      setDelta("");
      setReason("");
      detail.reload();
      toast("success", "Kredi güncellendi.");
    });
  }

  return (
    <>
      <Link href="/users" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Kullanıcılar
      </Link>
      {detail.error && !user ? (
        <ErrorState message={detail.error.message} onRetry={detail.reload} />
      ) : !user ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-lg font-semibold text-primary" aria-hidden>
                {(user.name ?? user.email ?? "M").slice(0, 1).toLocaleUpperCase("tr")}
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold tracking-tight">{user.name ?? user.email ?? "Misafir kullanıcı"}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {user.isGuest ? <Badge className={badgeTone.neutral}>Misafir</Badge> : <Badge className={badgeTone.primary}>Kayıtlı</Badge>}
                  {user.plan === "PRO" && <Badge className={badgeTone.warn}>PRO</Badge>}
                  {user.status === "BANNED" ? <Badge className={badgeTone.danger}>Engelli</Badge> : <Badge className={badgeTone.good}>Aktif</Badge>}
                  {user.role !== "USER" && <Badge variant="outline">Yönetici · {user.role}</Badge>}
                  <span className="font-mono text-xs text-muted-foreground">{user.id}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link href={`/designs?userId=${encodeURIComponent(user.id)}`}>
                  <ImageIcon aria-hidden /> Tasarımları
                </Link>
              </Button>
              {writable && (
                <Button variant={user.status === "ACTIVE" ? "destructive" : "default"} onClick={toggleBan} disabled={busy === "status"}>
                  <Spin on={busy === "status"} />
                  {user.status === "ACTIVE" ? <Ban aria-hidden /> : <CircleCheck aria-hidden />}
                  {user.status === "ACTIVE" ? "Engelle" : "Engeli kaldır"}
                </Button>
              )}
            </div>
          </div>

          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Coins} label="Ek kredi" value={fmtInt(user.credits)} note="Satın alınan, hediye ve ödül kredileri" />
            <StatCard icon={Sparkles} label="Bugünkü ücretsiz hak" value={fmtInt(user.dailyFreeRemaining)} tone="good" note="Her gün yenilenir" />
            <StatCard icon={ImageIcon} label="Tasarım" value={fmtInt(user.designsCount)} tone="neutral" note={`Kayıt: ${fmtDate(user.createdAt)}`} />
            <StatCard
              icon={Crown}
              label="Plan"
              value={user.plan === "PRO" ? "PRO" : "Ücretsiz"}
              tone={user.plan === "PRO" ? "warn" : "neutral"}
              note={user.plan === "PRO" ? (user.planExpiresAt ? `${fmtDate(user.planExpiresAt)} tarihine kadar` : "Süresiz") : "Abonelik yok"}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
              <Section title="Kredi hareketleri" description="Son 50 hareket" flush>
                {user.ledger.length === 0 ? (
                  <EmptyState title="Hareket yok" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Tarih</TableHead>
                        <TableHead className="text-right">Değişim</TableHead>
                        <TableHead className="pr-6">Gerekçe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="tabular">
                      {user.ledger.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="pl-6 whitespace-nowrap text-muted-foreground">{fmtDateTime(l.createdAt)}</TableCell>
                          <TableCell className={`text-right font-medium ${l.delta < 0 ? "text-danger" : "text-good"}`}>
                            {l.delta > 0 ? "+" : ""}
                            {fmtInt(l.delta)}
                          </TableCell>
                          <TableCell className="pr-6 whitespace-normal">
                            {ledgerLabel(l.reason)}
                            {l.refId && <span className="ml-1 font-mono text-[11px] text-muted-foreground">({l.refId})</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>

              <Section
                title="Son tasarımlar"
                action={
                  <Button variant="link" size="sm" className="h-auto p-0" asChild>
                    <Link href={`/designs?userId=${encodeURIComponent(user.id)}`}>Tümünü gör</Link>
                  </Button>
                }
              >
                {user.recentDesigns.length === 0 ? (
                  <EmptyState title="Henüz tasarım yok" />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {user.recentDesigns.map((d) => (
                      <DesignCard key={d.id} design={d} styleName={styles.data?.find((s) => s.id === d.styleId)?.nameTr ?? d.styleId ?? undefined} />
                    ))}
                  </div>
                )}
              </Section>

              <UserSessions userId={user.id} writable={writable} />
            </div>

            <div className="flex min-w-0 flex-col gap-5">
              <Section title="Profil">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Ad</dt>
                  <dd className="min-w-0 break-words">{user.name ?? "—"}</dd>
                  <dt className="text-muted-foreground">E-posta</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">{user.email ?? "—"}</dd>
                  <dt className="text-muted-foreground">Rol</dt>
                  <dd>{user.role === "USER" ? "Kullanıcı" : `Yönetici (${user.role})`}</dd>
                  <dt className="text-muted-foreground">Dil</dt>
                  <dd className="uppercase">{user.locale}</dd>
                  <dt className="text-muted-foreground">Kayıt</dt>
                  <dd>{fmtDateTime(user.createdAt)}</dd>
                  <dt className="text-muted-foreground">Son görülme</dt>
                  <dd>{fmtDateTime(user.lastSeenAt)}</dd>
                </dl>
              </Section>

              <Section title="Mağaza abonelikleri" description="RevenueCat’ten gelen son durum">
                {user.subscriptions.length === 0 ? (
                  <Hint>Mağaza aboneliği yok.</Hint>
                ) : (
                  <ul className="grid gap-3">
                    {user.subscriptions.map((s) => {
                      const st = SUB_STATUS[s.status] ?? { label: s.status, className: badgeTone.neutral };
                      return (
                        <li key={`${s.entitlement}-${s.productId}`} className="rounded-lg border p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">{s.productId ?? s.entitlement}</span>
                            <Badge className={st.className}>{st.label}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[s.store ? (STORES[s.store] ?? s.store) : null, s.environment === "SANDBOX" ? "Deneme ortamı" : null, s.expiresAt ? `Bitiş ${fmtDate(s.expiresAt)}` : null]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>

              {writable && (
                <>
                  <Section title="Plan" description={user.plan === "PRO" ? (user.planExpiresAt ? `PRO · ${fmtDate(user.planExpiresAt)} tarihine kadar` : "PRO · süresiz") : "Ücretsiz"}>
                    <form onSubmit={savePlan} className="grid gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="plan">Plan</Label>
                        <Select value={plan.plan} onValueChange={(v) => setPlanDraft({ ...plan, plan: v as "FREE" | "PRO" })}>
                          <SelectTrigger id="plan" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="FREE">Ücretsiz</SelectItem>
                            <SelectItem value="PRO">PRO</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="expires">PRO bitiş tarihi</Label>
                        <Input id="expires" type="date" disabled={plan.plan !== "PRO"} value={plan.plan === "PRO" ? plan.expires : ""} onChange={(e) => setPlanDraft({ ...plan, expires: e.target.value })} />
                        <Hint>Boş bırakılırsa süresiz.</Hint>
                      </div>
                      <Button type="submit" disabled={!planDraft || busy === "plan"}>
                        <Spin on={busy === "plan"} />
                        <CalendarClock aria-hidden /> Planı kaydet
                      </Button>
                    </form>
                  </Section>

                  <Section title="Kredi düzeltme" description="Kullanıcıya “Destek ekibinden düzenleme” diye görünür; bildirim gitmez.">
                    <form onSubmit={adjustCredits} className="grid gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="delta">Değişim</Label>
                        <Input id="delta" type="number" inputMode="numeric" min={-1000} max={1000} step={1} value={delta} onChange={(e) => setDelta(e.target.value)} />
                        <Hint>Eklemek için pozitif, düşmek için negatif (−1000…1000).</Hint>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="reason">Gerekçe</Label>
                        <Input id="reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ör. destek talebi #1234 telafisi" />
                      </div>
                      <Button type="submit" variant="outline" disabled={!delta || !reason.trim() || busy === "credits"}>
                        <Spin on={busy === "credits"} />
                        <Coins aria-hidden /> Krediyi uygula
                      </Button>
                    </form>
                  </Section>

                  <Section title="Hediye gönder" description="Kullanıcıya “Hediye” olarak görünür ve bildirim gider.">
                    <form onSubmit={sendGift} className="grid gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="gift-credits">Kredi</Label>
                        <Input id="gift-credits" type="number" min={1} max={500} value={gift.credits} onChange={(e) => setGift((g) => ({ ...g, credits: e.target.value }))} />
                        <Hint>1–500 kredi.</Hint>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="gift-message">Kullanıcıya mesaj (isteğe bağlı)</Label>
                        <Input id="gift-message" maxLength={140} value={gift.message} onChange={(e) => setGift((g) => ({ ...g, message: e.target.value }))} placeholder="Ör. Sabrın için teşekkürler!" />
                        <Hint>Bildirimde ve e-postada görünür · {gift.message.length}/140</Hint>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={gift.email} onChange={(e) => setGift((g) => ({ ...g, email: e.target.checked }))} className="size-4 accent-[var(--primary)]" />
                        E-posta da gönder (yalnız doğrulanmış adrese)
                      </label>
                      <div className="grid gap-2">
                        <Label htmlFor="gift-reason">Gerekçe (iç not)</Label>
                        <Input id="gift-reason" maxLength={200} value={gift.reason} onChange={(e) => setGift((g) => ({ ...g, reason: e.target.value }))} placeholder="Ör. uzun süre hata yaşadı" />
                        <Hint>Yalnız denetim kaydına yazılır; kullanıcı görmez.</Hint>
                      </div>
                      <Button type="submit" disabled={!gift.credits || gift.reason.trim().length < 3 || busy === "gift"}>
                        <Spin on={busy === "gift"} />
                        <Gift aria-hidden /> Hediyeyi gönder
                      </Button>
                    </form>
                  </Section>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

const LOGIN_METHOD: Record<string, string> = { password: "E-posta", register: "Kayıt", guest: "Misafir", google: "Google", apple: "Apple", admin: "Yönetim paneli", review: "İnceleme hesabı", unknown: "—" };
const LOGIN_REASON: Record<string, string> = { bad_password: "yanlış parola", bad_second_factor: "doğrulama kodu hatalı", suspended: "hesap askıda" };

/** API.md §7.37: open sessions (close one or all) and the last sign-in attempts. SUPPORT reads; ADMIN closes. */
function UserSessions({ userId, writable }: { userId: string; writable: boolean }) {
  const data = useApi<AdminUserSessions>(`/users/${encodeURIComponent(userId)}/sessions`);
  const { toast } = useFeedback();
  const [closing, setClosing] = useState<{ id: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function close(sessionId: string | null, reason: string) {
    setBusy(true);
    try {
      await api(sessionId ? `/users/${encodeURIComponent(userId)}/sessions/${sessionId}/revoke` : `/users/${encodeURIComponent(userId)}/sessions/revoke-all`, { method: "POST", body: { reason } });
      toast("success", sessionId ? "Oturum kapatıldı." : "Bütün oturumlar kapatıldı.");
      setClosing(null);
      data.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kapatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title="Açık oturumlar"
        description="Kapatılan oturum hemen düşer. IP’nin yalnız ilk kısmı saklanır."
        flush
        action={
          writable && data.data && data.data.sessions.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => setClosing({ id: null })}>
              Hepsini kapat
            </Button>
          ) : undefined
        }
      >
        {data.error && !data.data ? (
          <ErrorState message={data.error.message} onRetry={data.reload} />
        ) : !data.data ? (
          <Spinner />
        ) : data.data.sessions.length === 0 ? (
          <EmptyState title="Açık oturum yok" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Cihaz</TableHead>
                <TableHead>Son etkinlik</TableHead>
                <TableHead>Açılış</TableHead>
                <TableHead className="pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-6">
                    <span className="block font-medium">{s.device}</span>
                    <span className="block text-xs text-muted-foreground">
                      {LOGIN_METHOD[s.method] ?? s.method} · {s.ipPrefix}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">{fmtDateTime(s.lastUsedAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDateTime(s.createdAt)}</TableCell>
                  <TableCell className="pr-6 text-right">
                    {writable && (
                      <Button size="sm" variant="ghost" onClick={() => setClosing({ id: s.id })}>
                        Kapat
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Son giriş denemeleri" description="Giriş geçmişi 90 gün tutulur." flush>
        {!data.data ? (
          <Spinner />
        ) : data.data.logins.length === 0 ? (
          <EmptyState title="Kayıt yok" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Tarih</TableHead>
                <TableHead>Sonuç</TableHead>
                <TableHead className="pr-6">Cihaz</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.logins.map((l, i) => (
                <TableRow key={`${l.createdAt}-${i}`}>
                  <TableCell className="pl-6 text-xs text-muted-foreground">{fmtDateTime(l.createdAt)}</TableCell>
                  <TableCell>
                    {l.ok ? <Badge className={badgeTone.good}>Giriş</Badge> : <Badge className={badgeTone.danger}>Başarısız</Badge>}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {LOGIN_METHOD[l.method] ?? l.method}
                      {!l.ok && l.reason ? ` · ${LOGIN_REASON[l.reason] ?? l.reason}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="pr-6 text-xs">
                    {l.device} <span className="text-muted-foreground">· {l.ipPrefix}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {closing && (
        <ReasonDialog
          title={closing.id ? "Oturum kapatılsın mı?" : "Bütün oturumlar kapatılsın mı?"}
          description="Kullanıcı o cihazda yeniden giriş yapmak zorunda kalır."
          confirmLabel="Kapat"
          destructive
          busy={busy}
          onConfirm={(r) => void close(closing.id, r)}
          onClose={() => setClosing(null)}
        />
      )}
    </>
  );
}

/** Ledger reasons in plain Turkish (the raw code stays in the API and the audit log). */
function ledgerLabel(reason: string): string {
  if (reason.startsWith("purchase:")) return `Kredi paketi (${reason.slice(9)})`;
  if (reason.startsWith("admin: ")) return `Yönetici: ${reason.slice(7)}`;
  const known: Record<string, string> = {
    welcome: "Hoş geldin hediyesi",
    gift: "Hediye (bildirimli)",
    promo: "Promosyon kodu",
    promo_pro: "Promosyon kodu (PRO günü)",
    referral_invitee: "Davet ödülü (davetle katıldı)",
    referral_inviter: "Davet ödülü (arkadaşı tasarım yaptı)",
    generation: "Tasarım",
    refund: "İade (tasarım tamamlanamadı)",
    daily_free: "Günlük ücretsiz hak",
  };
  return known[reason] ?? reason;
}
