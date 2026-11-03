"use client";

import { Star, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DesignCard } from "@/components/design-card";
import { useFeedback } from "@/components/feedback";
import { Button, EmptyState, ErrorState, Input, LoadMore, PageHeader, Select, Spinner } from "@/components/common";
import { api, ApiError, useApi, usePaged } from "@/lib/api";
import { STATUS_LABELS, TOOL_LABELS } from "@/lib/format";
import type { AdminDesign, AdminStyle, Design } from "@/lib/types";

export function DesignsView({ initialUserId }: { initialUserId: string }) {
  const [status, setStatus] = useState("");
  const [tool, setTool] = useState("");
  const [styleId, setStyleId] = useState("");
  const [userIdInput, setUserIdInput] = useState(initialUserId);
  const [userId, setUserId] = useState(initialUserId.trim());
  useEffect(() => {
    const t = setTimeout(() => setUserId(userIdInput.trim()), 400);
    return () => clearTimeout(t);
  }, [userIdInput]);
  const designs = usePaged<AdminDesign>("/designs", { status, tool, styleId, userId });
  const styles = useApi<AdminStyle[]>("/styles");
  const { toast, confirm } = useFeedback();
  const [busyId, setBusyId] = useState<string | null>(null);

  const styleName = (id: string | null) => (id ? (styles.data?.find((s) => s.id === id)?.nameTr ?? id) : undefined);
  const filtered = Boolean(status || tool || styleId || userIdInput.trim());

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
      toast("success", "Tasarım silindi.");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Silme başarısız.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title="Tasarımlar" description="Tüm üretimler, moderasyon ve ilham galerisi seçimi" />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Select aria-label="Durum" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="">Tüm durumlar</option>
          {(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Araç" value={tool} onChange={(e) => setTool(e.target.value)} className="w-44">
          <option value="">Tüm araçlar</option>
          {Object.entries(TOOL_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        <Select aria-label="Stil" value={styleId} onChange={(e) => setStyleId(e.target.value)} className="w-44">
          <option value="">Tüm stiller</option>
          {styles.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nameTr}
            </option>
          ))}
        </Select>
        <Input aria-label="Kullanıcı kimliği" value={userIdInput} onChange={(e) => setUserIdInput(e.target.value)} placeholder="Kullanıcı kimliği" className="w-64" />
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus("");
              setTool("");
              setStyleId("");
              setUserIdInput("");
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Filtreleri temizle
          </Button>
        )}
      </div>

      {designs.error && designs.items.length === 0 ? (
        <ErrorState message={designs.error.message} onRetry={designs.reload} />
      ) : designs.loading && designs.items.length === 0 ? (
        <Spinner />
      ) : designs.items.length === 0 ? (
        <EmptyState title="Tasarım bulunamadı" description={filtered ? "Filtreleri değiştirip tekrar dene." : "Kullanıcılar henüz tasarım üretmedi."} />
      ) : (
        <div className={designs.loading ? "opacity-60 transition-opacity" : ""}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {designs.items.map((d) => (
              <DesignCard
                key={d.id}
                design={d}
                styleName={styleName(d.styleId)}
                subtitle={
                  <Link href={`/users/${encodeURIComponent(d.userId)}`} className="hover:text-primary hover:underline">
                    {d.userEmail ?? "Misafir kullanıcı"}
                  </Link>
                }
                actions={
                  <>
                    <Button
                      size="sm"
                      variant={d.featured ? "primary" : "secondary"}
                      onClick={() => toggleFeatured(d)}
                      disabled={busyId === d.id || d.status !== "SUCCEEDED"}
                      aria-pressed={d.featured}
                      title={d.status !== "SUCCEEDED" ? "Yalnız başarılı tasarımlar öne çıkarılabilir" : undefined}
                    >
                      <Star className="h-3.5 w-3.5" fill={d.featured ? "currentColor" : "none"} aria-hidden />
                      {d.featured ? "Öne çıkan" : "Öne çıkar"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(d)} disabled={busyId === d.id} className="text-danger">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> Sil
                    </Button>
                  </>
                }
              />
            ))}
          </div>
          {designs.error && <p className="pt-3 text-sm text-danger">{designs.error.message}</p>}
          <LoadMore hasMore={Boolean(designs.nextCursor)} loading={designs.loadingMore} onClick={designs.loadMore} />
        </div>
      )}
    </>
  );
}
