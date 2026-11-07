"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadMore, PageHeader, Spinner } from "@/components/common";
import { badgeTone } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePaged } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";

// Denetim kaydı: yönetici işlemleri. Alan (işlemin ön eki) ve yönetici e-postasıyla süzülür; satır ayrıntısı pencerede.

const AREAS: Record<string, string> = {
  user: "Kullanıcı",
  admin: "Yönetici hesabı",
  billing: "Ödeme",
  settings: "Ayarlar",
  product: "Ürün kataloğu",
  style: "Stil",
  prompt: "İstem şablonu",
  ai: "AI motoru",
  features: "Özellikler",
  promo: "Promosyon",
  gift: "Hediye",
  referral: "Davet",
  loyalty: "Sadakat",
  price_schedule: "Planlı fiyat",
  broadcast: "Toplu gönderim",
  lifecycle: "Yaşam döngüsü",
  marketing: "Pazarlama",
  blog: "Blog",
  site_content: "Ana sayfa ve SSS",
  site_preview: "Web önizleme bağlantısı",
  waitlist: "Bekleme listesi",
  theme: "Tema",
  legal: "Yasal metin",
  kvkk: "KVKK",
  support: "Destek",
  report: "İçerik bildirimi",
  design: "Tasarım",
  org: "Ekip",
  partner: "İş ortağı",
  review_account: "İnceleme hesabı",
  alerts: "Uyarılar",
  jobs: "Zamanlı iş",
  export: "Dışa aktarma",
};

const areaOf = (action: string) => action.split(".")[0];
const DANGER = /(delete|ban|reject|failed|revoke|cancel|mfa_reset)/;

function metaText(meta: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(meta);
    return s === "{}" ? "—" : s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return "—";
  }
}

export default function AuditPage() {
  const [area, setArea] = useState("all");
  const [actorInput, setActorInput] = useState("");
  const [actor, setActor] = useState("");
  const [open, setOpen] = useState<AuditEntry | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setActor(actorInput.trim().length >= 2 ? actorInput.trim() : ""), 300);
    return () => clearTimeout(t);
  }, [actorInput]);
  const audit = usePaged<AuditEntry>("/audit", { area: area === "all" ? undefined : area, actor: actor || undefined });
  const filtered = area !== "all" || Boolean(actor);

  return (
    <>
      <PageHeader title="Denetim kaydı" description="Yönetici işlemleri: kim, ne zaman, neyi değiştirdi. Metinler ve kişisel veriler kayda girmez; yalnız neyin değiştiği yazılır." />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={area} onValueChange={setArea}>
          <SelectTrigger className="w-full sm:w-56" aria-label="Alan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="all">Tüm alanlar</SelectItem>
            {Object.entries(AREAS)
              .sort((a, b) => a[1].localeCompare(b[1], "tr"))
              .map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Yönetici e-postası</span>
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input value={actorInput} onChange={(e) => setActorInput(e.target.value)} placeholder="Yönetici e-postası" className="pl-8" />
        </label>
      </div>

      {audit.error && audit.items.length === 0 ? (
        <ErrorState message={audit.error.message} onRetry={audit.reload} />
      ) : audit.loading && audit.items.length === 0 ? (
        <Spinner />
      ) : audit.items.length === 0 ? (
        <EmptyState title="Kayıt yok" description={filtered ? "Süzgeci değiştirip tekrar dene." : "Yönetici işlemleri burada listelenir."} />
      ) : (
        <Card className={`py-0 ${audit.loading ? "opacity-60 transition-opacity" : ""}`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Zaman</TableHead>
                <TableHead>Yönetici</TableHead>
                <TableHead>İşlem</TableHead>
                <TableHead>Hedef</TableHead>
                <TableHead className="pr-6">Ayrıntı</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.items.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => setOpen(a)}>
                  <TableCell className="pl-6 whitespace-nowrap text-muted-foreground">{fmtDateTime(a.createdAt)}</TableCell>
                  <TableCell className="max-w-56 truncate">{a.actorEmail ?? "Sistem"}</TableCell>
                  <TableCell>
                    <span className="flex flex-col items-start gap-1">
                      <Badge className={DANGER.test(a.action) ? badgeTone.danger : badgeTone.neutral}>{AREAS[areaOf(a.action)] ?? areaOf(a.action)}</Badge>
                      <span className="font-mono text-xs">{a.action}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {a.targetType === "user" && a.targetId ? (
                      <Link href={`/users/${a.targetId}`} className="font-mono text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        kullanıcı · {a.targetId.slice(0, 8)}…
                      </Link>
                    ) : (
                      <>
                        <span>{a.targetType}</span>
                        {a.targetId && <span className="ml-1 font-mono text-[11px] text-muted-foreground">{a.targetId.length > 24 ? `${a.targetId.slice(0, 24)}…` : a.targetId}</span>}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="max-w-md pr-6">
                    <button type="button" className="block w-full truncate text-left font-mono text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setOpen(a)}>
                      {metaText(a.meta)}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {audit.error && audit.items.length > 0 && <p className="pt-3 text-sm text-danger">{audit.error.message}</p>}
      <LoadMore hasMore={Boolean(audit.nextCursor)} loading={audit.loadingMore} onClick={audit.loadMore} />

      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="font-mono text-base">{open.action}</DialogTitle>
              <DialogDescription>
                {fmtDateTime(open.createdAt)} · {open.actorEmail ?? "Sistem"}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Hedef</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">
                {open.targetType}
                {open.targetId && <span className="ml-1 font-mono text-xs text-muted-foreground">{open.targetId}</span>}
              </dd>
            </dl>
            <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{JSON.stringify(open.meta, null, 2)}</pre>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
