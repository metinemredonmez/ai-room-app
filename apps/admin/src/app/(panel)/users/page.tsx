"use client";

import { Crown, Search, UserCheck, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadMore, PageHeader, Spinner } from "@/components/common";
import { badgeTone, StatCard } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi, usePaged } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminStats, AdminUser } from "@/lib/types";

// Kullanıcılar: arama, tür / plan / durum süzgeci (GET /admin/users), satırdan detaya.

const KIND = [
  { value: "all", label: "Tüm hesaplar" },
  { value: "registered", label: "Kayıtlı" },
  { value: "guest", label: "Misafir" },
] as const;
const PLAN = [
  { value: "all", label: "Tüm planlar" },
  { value: "PRO", label: "PRO" },
  { value: "FREE", label: "Ücretsiz" },
] as const;
const STATUS = [
  { value: "all", label: "Tüm durumlar" },
  { value: "ACTIVE", label: "Aktif" },
  { value: "BANNED", label: "Engelli" },
] as const;

function Filter<T extends string>({ id, value, onChange, options }: { id: string; value: T; onChange: (v: T) => void; options: readonly { value: T; label: string }[] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} className="w-full sm:w-40" aria-label={options[0].label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function displayName(u: Pick<AdminUser, "email" | "name">) {
  return u.name ?? u.email ?? "Misafir kullanıcı";
}

export default function UsersPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<(typeof KIND)[number]["value"]>("all");
  const [plan, setPlan] = useState<(typeof PLAN)[number]["value"]>("all");
  const [status, setStatus] = useState<(typeof STATUS)[number]["value"]>("all");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const stats = useApi<AdminStats>("/stats", { days: 7 });
  const users = usePaged<AdminUser>("/users", {
    q,
    kind: kind === "all" ? undefined : kind,
    plan: plan === "all" ? undefined : plan,
    status: status === "all" ? undefined : status,
  });
  const t = stats.data?.totals;
  const filtered = Boolean(q) || kind !== "all" || plan !== "all" || status !== "all";

  return (
    <>
      <PageHeader title="Kullanıcılar" description="Misafir ve kayıtlı hesaplar, planlar ve haklar. Ayrıntı için satıra tıkla." />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} label="Toplam hesap" value={t && fmtInt(t.users)} />
        <StatCard icon={UserCheck} label="Kayıtlı" value={t && fmtInt(t.registered)} tone="good" />
        <StatCard icon={UserRound} label="Misafir" value={t && fmtInt(t.guests)} tone="neutral" />
        <StatCard icon={Crown} label="PRO" value={t && fmtInt(t.pro)} tone="warn" />
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Kullanıcı ara</span>
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="E-posta, ad veya kimlik ara" className="h-9 pl-8" />
        </label>
        <Filter id="kind" value={kind} onChange={setKind} options={KIND} />
        <Filter id="plan" value={plan} onChange={setPlan} options={PLAN} />
        <Filter id="status" value={status} onChange={setStatus} options={STATUS} />
      </div>

      {users.error && users.items.length === 0 ? (
        <ErrorState message={users.error.message} onRetry={users.reload} />
      ) : users.loading && users.items.length === 0 ? (
        <Spinner />
      ) : users.items.length === 0 ? (
        <EmptyState title="Kullanıcı bulunamadı" description={filtered ? "Aramayı ya da süzgeçleri değiştirip tekrar dene." : undefined} />
      ) : (
        <Card className={`py-0 ${users.loading ? "opacity-60 transition-opacity" : ""}`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Kullanıcı</TableHead>
                <TableHead>Hesap</TableHead>
                <TableHead className="text-right">Kredi</TableHead>
                <TableHead className="text-right">Günlük hak</TableHead>
                <TableHead className="text-right">Tasarım</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="pr-6">Son görülme</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular">
              {users.items.map((u) => (
                <TableRow key={u.id} className="cursor-pointer" onClick={() => router.push(`/users/${encodeURIComponent(u.id)}`)}>
                  <TableCell className="max-w-72 pl-6">
                    <Link href={`/users/${encodeURIComponent(u.id)}`} className="block truncate font-medium hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                      {displayName(u)}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">{u.name && u.email ? u.email : <span className="font-mono">{u.id}</span>}</span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {u.isGuest ? <Badge className={badgeTone.neutral}>Misafir</Badge> : <Badge className={badgeTone.primary}>Kayıtlı</Badge>}
                      {u.plan === "PRO" && <Badge className={badgeTone.warn}>PRO</Badge>}
                      {u.role !== "USER" && <Badge variant="outline">Yönetici</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{fmtInt(u.credits)}</TableCell>
                  <TableCell className="text-right">{fmtInt(u.dailyFreeRemaining)}</TableCell>
                  <TableCell className="text-right">{fmtInt(u.designsCount)}</TableCell>
                  <TableCell>{u.status === "BANNED" ? <Badge className={badgeTone.danger}>Engelli</Badge> : <Badge className={badgeTone.good}>Aktif</Badge>}</TableCell>
                  <TableCell className="pr-6 whitespace-nowrap text-muted-foreground">{fmtDateTime(u.lastSeenAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {users.error && users.items.length > 0 && <p className="pt-3 text-sm text-danger">{users.error.message}</p>}
      <LoadMore hasMore={Boolean(users.nextCursor)} loading={users.loadingMore} onClick={users.loadMore} />
    </>
  );
}
