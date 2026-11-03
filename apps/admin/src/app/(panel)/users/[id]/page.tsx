"use client";

import { ArrowLeft, Ban, CircleCheck, Coins } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { DesignCard } from "@/components/design-card";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, Table, td, th } from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminStyle, AdminUser, AdminUserDetail } from "@/lib/types";

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
      <Link href="/users" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
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
                <dt className="text-muted">Ad</dt>
                <dd className="text-fg">{user.name ?? "—"}</dd>
                <dt className="text-muted">E-posta</dt>
                <dd className="break-all text-fg">{user.email ?? "—"}</dd>
                <dt className="text-muted">Tür</dt>
                <dd>{user.isGuest ? <Badge>Misafir</Badge> : <Badge tone="primary">Kayıtlı</Badge>}</dd>
                <dt className="text-muted">Rol</dt>
                <dd className="text-fg">{user.role === "USER" ? "Kullanıcı" : `Yönetici (${user.role})`}</dd>
                <dt className="text-muted">Durum</dt>
                <dd>{user.status === "BANNED" ? <Badge tone="danger">Engelli</Badge> : <Badge tone="good">Aktif</Badge>}</dd>
                <dt className="text-muted">Dil</dt>
                <dd className="uppercase text-fg">{user.locale}</dd>
                <dt className="text-muted">Kayıt</dt>
                <dd className="text-fg">{fmtDateTime(user.createdAt)}</dd>
                <dt className="text-muted">Son görülme</dt>
                <dd className="text-fg">{fmtDateTime(user.lastSeenAt)}</dd>
                <dt className="text-muted">Tasarım</dt>
                <dd className="tabular text-fg">{fmtInt(user.designsCount)}</dd>
              </dl>
            </Card>

            <Card title="Plan">
              <form onSubmit={savePlan} className="flex flex-col gap-3">
                <p className="text-sm text-muted">
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
                  <p className="text-xs text-muted">Ek kredi</p>
                  <p className="text-xl font-semibold text-fg">{fmtInt(user.credits)}</p>
                </div>
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="text-xs text-muted">Bugünkü ücretsiz hak</p>
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
                      <td className={`${td} whitespace-nowrap text-muted`}>{fmtDateTime(l.createdAt)}</td>
                      <td className={`${td} text-right font-medium ${l.delta < 0 ? "text-danger" : "text-good"}`}>
                        {l.delta > 0 ? "+" : ""}
                        {fmtInt(l.delta)}
                      </td>
                      <td className={td}>
                        {l.reason}
                        {l.refId && <span className="ml-1 font-mono text-[11px] text-muted">({l.refId})</span>}
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
        </>
      )}
    </>
  );
}
