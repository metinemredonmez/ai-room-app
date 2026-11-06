"use client";

import { ArrowLeft, Ban, CircleCheck, Coins, Gift } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { DesignCard } from "@/components/design-card";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, Table, td, th } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminMe, AdminStyle, AdminUser, AdminUserDetail, AdminUserSessions } from "@/lib/types";

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi<AdminUserDetail>(id ? `/users/${encodeURIComponent(id)}` : null);
  const styles = useApi<AdminStyle[]>("/styles");
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

  async function toggleBan() {
    if (!user) return;
    const banning = user.status === "ACTIVE";
    const ok = await confirm({
      title: banning ? "Kullanıcı engellensin mi?" : "Engel kaldırılsın mı?",
      description: banning ? "Kullanıcı uygulamaya giriş yapamaz ve yeni tasarım üretemez." : "Kullanıcı tekrar uygulamayı kullanabilir.",
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
      <Link href="/users" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Kullanıcılar
      </Link>
      {detail.error && !user ? (
        <ErrorState message={detail.error.message} onRetry={detail.reload} />
      ) : !user ? (
        <Spinner />
      ) : (
        <>
          <PageHeader
            title={user.email ?? user.name ?? "Misafir kullanıcı"}
            description={`Kimlik: ${user.id}`}
            actions={
              <Button variant={user.status === "ACTIVE" ? "danger" : "primary"} onClick={toggleBan} loading={busy === "status"}>
                {user.status === "ACTIVE" ? <Ban className="h-4 w-4" aria-hidden /> : <CircleCheck className="h-4 w-4" aria-hidden />}
                {user.status === "ACTIVE" ? "Engelle" : "Engeli kaldır"}
              </Button>
            }
          />

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Profil">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Ad</dt>
                <dd className="text-fg">{user.name ?? "—"}</dd>
                <dt className="text-muted-foreground">E-posta</dt>
                <dd className="break-all text-fg">{user.email ?? "—"}</dd>
                <dt className="text-muted-foreground">Tür</dt>
                <dd>{user.isGuest ? <Badge>Misafir</Badge> : <Badge tone="primary">Kayıtlı</Badge>}</dd>
                <dt className="text-muted-foreground">Rol</dt>
                <dd className="text-fg">{user.role === "USER" ? "Kullanıcı" : `Yönetici (${user.role})`}</dd>
                <dt className="text-muted-foreground">Durum</dt>
                <dd>{user.status === "BANNED" ? <Badge tone="danger">Engelli</Badge> : <Badge tone="good">Aktif</Badge>}</dd>
                <dt className="text-muted-foreground">Dil</dt>
                <dd className="uppercase text-fg">{user.locale}</dd>
                <dt className="text-muted-foreground">Kayıt</dt>
                <dd className="text-fg">{fmtDateTime(user.createdAt)}</dd>
                <dt className="text-muted-foreground">Son görülme</dt>
                <dd className="text-fg">{fmtDateTime(user.lastSeenAt)}</dd>
                <dt className="text-muted-foreground">Tasarım</dt>
                <dd className="tabular text-fg">{fmtInt(user.designsCount)}</dd>
              </dl>
            </Card>

            <Card title="Plan">
              <form onSubmit={savePlan} className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Şu an:{" "}
                  <span className="font-medium text-fg">{user.plan === "PRO" ? "PRO" : "Ücretsiz"}</span>
                  {user.plan === "PRO" && user.planExpiresAt ? ` · ${fmtDate(user.planExpiresAt)} tarihine kadar` : ""}
                </p>
                <Field label="Plan" htmlFor="plan">
                  <Select id="plan" value={plan.plan} onChange={(e) => setPlanDraft({ ...plan, plan: e.target.value as "FREE" | "PRO" })}>
                    <option value="FREE">Ücretsiz</option>
                    <option value="PRO">PRO</option>
                  </Select>
                </Field>
                <Field label="PRO bitiş tarihi" htmlFor="expires" hint="Boş bırakılırsa süresiz.">
                  <Input
                    id="expires"
                    type="date"
                    disabled={plan.plan !== "PRO"}
                    value={plan.plan === "PRO" ? plan.expires : ""}
                    onChange={(e) => setPlanDraft({ ...plan, expires: e.target.value })}
                  />
                </Field>
                <Button type="submit" variant="primary" loading={busy === "plan"} disabled={!planDraft}>
                  Planı kaydet
                </Button>
              </form>
            </Card>

            <Card title="Krediler">
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Ek kredi</p>
                  <p className="text-xl font-semibold text-fg">{fmtInt(user.credits)}</p>
                </div>
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Bugünkü ücretsiz hak</p>
                  <p className="text-xl font-semibold text-fg">{fmtInt(user.dailyFreeRemaining)}</p>
                </div>
              </div>
              <form onSubmit={adjustCredits} className="flex flex-col gap-3">
                <Field label="Değişim" htmlFor="delta" hint="Eklemek için pozitif, düşmek için negatif (−1000…1000).">
                  <Input id="delta" type="number" inputMode="numeric" min={-1000} max={1000} step={1} value={delta} onChange={(e) => setDelta(e.target.value)} />
                </Field>
                <Field label="Gerekçe" htmlFor="reason">
                  <Input id="reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ör. destek talebi #1234 telafisi" />
                </Field>
                <Button type="submit" loading={busy === "credits"} disabled={!delta || !reason.trim()}>
                  <Coins className="h-4 w-4" aria-hidden /> Krediyi uygula
                </Button>
              </form>
              <p className="mt-2 text-[11px] text-muted-foreground">Düzeltme kullanıcıya yalnız “Destek ekibinden düzenleme” diye görünür; bildirim gitmez.</p>

              <form onSubmit={sendGift} className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
                <p className="flex items-center gap-2 text-sm font-medium text-fg">
                  <Gift className="h-4 w-4" aria-hidden /> Hediye gönder
                </p>
                <Field label="Kredi" htmlFor="gift-credits" hint="1–500; kullanıcıya “Hediye” olarak görünür ve bildirim gider.">
                  <Input id="gift-credits" type="number" min={1} max={500} value={gift.credits} onChange={(e) => setGift((g) => ({ ...g, credits: e.target.value }))} />
                </Field>
                <Field label="Kullanıcıya mesaj (isteğe bağlı)" htmlFor="gift-message" hint={`Bildirimde ve e-postada görünür · ${gift.message.length}/140`}>
                  <Input id="gift-message" maxLength={140} value={gift.message} onChange={(e) => setGift((g) => ({ ...g, message: e.target.value }))} placeholder="Ör. Sabrın için teşekkürler!" />
                </Field>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" aria-label="E-posta da gönder" checked={gift.email} onChange={(e) => setGift((g) => ({ ...g, email: e.target.checked }))} className="h-4 w-4 accent-[var(--primary)]" />
                  E-posta da gönder (yalnız doğrulanmış adrese)
                </label>
                <Field label="Gerekçe (iç not)" htmlFor="gift-reason" hint="Yalnız denetim kaydına yazılır; kullanıcı görmez.">
                  <Input id="gift-reason" maxLength={200} value={gift.reason} onChange={(e) => setGift((g) => ({ ...g, reason: e.target.value }))} placeholder="Ör. uzun süre hata yaşadı" />
                </Field>
                <Button type="submit" variant="primary" loading={busy === "gift"} disabled={!gift.credits || gift.reason.trim().length < 3}>
                  <Gift className="h-4 w-4" aria-hidden /> Hediyeyi gönder
                </Button>
              </form>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <Card title="Kredi hareketleri">
              {user.ledger.length === 0 ? (
                <EmptyState title="Hareket yok" />
              ) : (
                <Table
                  head={
                    <tr>
                      <th className={th}>Tarih</th>
                      <th className={`${th} text-right`}>Değişim</th>
                      <th className={th}>Gerekçe</th>
                    </tr>
                  }
                >
                  {user.ledger.map((l) => (
                    <tr key={l.id}>
                      <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDateTime(l.createdAt)}</td>
                      <td className={`${td} text-right font-medium ${l.delta < 0 ? "text-danger" : "text-good"}`}>
                        {l.delta > 0 ? "+" : ""}
                        {fmtInt(l.delta)}
                      </td>
                      <td className={td}>
                        {ledgerLabel(l.reason)}
                        {l.refId && <span className="ml-1 font-mono text-[11px] text-muted-foreground">({l.refId})</span>}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>

            <Card title="Son tasarımlar" actions={<Link href={`/designs?userId=${encodeURIComponent(user.id)}`} className="text-xs text-primary hover:underline">Tümünü gör</Link>}>
              {user.recentDesigns.length === 0 ? (
                <EmptyState title="Henüz tasarım yok" />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {user.recentDesigns.map((d) => (
                    <DesignCard key={d.id} design={d} styleName={styles.data?.find((s) => s.id === d.styleId)?.nameTr ?? d.styleId ?? undefined} />
                  ))}
                </div>
              )}
            </Card>
          </div>

          <UserSessions userId={user.id} />
        </>
      )}
    </>
  );
}

const LOGIN_METHOD: Record<string, string> = { password: "E-posta", register: "Kayıt", guest: "Misafir", google: "Google", apple: "Apple", admin: "Yönetim paneli", review: "İnceleme hesabı", unknown: "—" };
const LOGIN_REASON: Record<string, string> = { bad_password: "yanlış parola", bad_second_factor: "doğrulama kodu hatalı", suspended: "hesap askıda" };

/** API.md §7.37: open sessions (close one or all) and the last sign-in attempts. SUPPORT reads; ADMIN closes. */
function UserSessions({ userId }: { userId: string }) {
  const data = useApi<AdminUserSessions>(`/users/${encodeURIComponent(userId)}/sessions`);
  const me = useApi<AdminMe>("/me");
  const canEdit = me.data ? ["ADMIN", "SUPER_ADMIN"].includes(me.data.role) : false;
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);

  async function close(sessionId: string | null) {
    const reason = window.prompt(sessionId ? "Neden bu oturum kapatılıyor? (denetim kaydına yazılır)" : "Neden bütün oturumlar kapatılıyor? (denetim kaydına yazılır)");
    if (!reason || reason.trim().length < 3) return;
    setBusy(sessionId ?? "all");
    try {
      await api(sessionId ? `/users/${encodeURIComponent(userId)}/sessions/${sessionId}/revoke` : `/users/${encodeURIComponent(userId)}/sessions/revoke-all`, { method: "POST", body: { reason: reason.trim() } });
      toast("success", sessionId ? "Oturum kapatıldı." : "Bütün oturumlar kapatıldı.");
      data.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kapatılamadı.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Card
        title="Açık oturumlar"
        actions={canEdit && data.data && data.data.sessions.length > 0 ? (
          <Button size="sm" variant="ghost" loading={busy === "all"} onClick={() => void close(null)}>Hepsini kapat</Button>
        ) : undefined}
      >
        {data.error && !data.data ? (
          <ErrorState message={data.error.message} onRetry={data.reload} />
        ) : !data.data ? (
          <Spinner />
        ) : data.data.sessions.length === 0 ? (
          <EmptyState title="Açık oturum yok" />
        ) : (
          <Table head={<tr><th className={th}>Cihaz</th><th className={th}>Son etkinlik</th><th className={th}>Açılış</th><th className={th} /></tr>}>
            {data.data.sessions.map((s) => (
              <tr key={s.id}>
                <td className={td}>
                  <div className="font-medium text-fg">{s.device}</div>
                  <div className="text-[11px] text-muted-foreground">{LOGIN_METHOD[s.method] ?? s.method} · {s.ipPrefix}</div>
                </td>
                <td className={`${td} whitespace-nowrap text-xs`}>{fmtDateTime(s.lastUsedAt)}</td>
                <td className={`${td} whitespace-nowrap text-xs text-muted-foreground`}>{fmtDateTime(s.createdAt)}</td>
                <td className={`${td} text-right`}>
                  {canEdit && <Button size="sm" variant="ghost" loading={busy === s.id} onClick={() => void close(s.id)}>Kapat</Button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">Kapatılan oturum hemen düşer. IP’nin yalnız ilk kısmı saklanır.</p>
      </Card>
      <Card title="Son giriş denemeleri">
        {!data.data ? (
          <Spinner />
        ) : data.data.logins.length === 0 ? (
          <EmptyState title="Kayıt yok" description="Giriş geçmişi 90 gün tutulur." />
        ) : (
          <Table head={<tr><th className={th}>Tarih</th><th className={th}>Sonuç</th><th className={th}>Cihaz</th></tr>}>
            {data.data.logins.map((l, i) => (
              <tr key={`${l.createdAt}-${i}`}>
                <td className={`${td} whitespace-nowrap text-xs text-muted-foreground`}>{fmtDateTime(l.createdAt)}</td>
                <td className={td}>
                  {l.ok ? <Badge tone="good">Giriş</Badge> : <Badge tone="danger">Başarısız</Badge>}
                  <span className="ml-1 text-xs text-muted-foreground">{LOGIN_METHOD[l.method] ?? l.method}{!l.ok && l.reason ? ` · ${LOGIN_REASON[l.reason] ?? l.reason}` : ""}</span>
                </td>
                <td className={`${td} text-xs`}>{l.device} <span className="text-muted-foreground">· {l.ipPrefix}</span></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
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
