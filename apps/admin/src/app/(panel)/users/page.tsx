"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, EmptyState, ErrorState, Input, LoadMore, PageHeader, Spinner, Table, td, th } from "@/components/common";
import { usePaged } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminUser } from "@/lib/types";

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const users = usePaged<AdminUser>("/users", { q });

  return (
    <>
      <PageHeader title="Kullanıcılar" description="Misafir ve kayıtlı hesaplar, planlar ve haklar" />
      <Card
        title={
          <label className="relative block w-72 max-w-full">
            <span className="sr-only">Kullanıcı ara</span>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="E-posta, ad veya kimlik ara" className="pl-8" />
          </label>
        }
      >
        {users.error && users.items.length === 0 ? (
          <ErrorState message={users.error.message} onRetry={users.reload} />
        ) : users.loading && users.items.length === 0 ? (
          <Spinner />
        ) : users.items.length === 0 ? (
          <EmptyState title="Kullanıcı bulunamadı" description={q ? "Aramayı değiştirip tekrar dene." : undefined} />
        ) : (
          <div className={users.loading ? "opacity-60 transition-opacity" : ""}>
            <Table
              head={
                <tr>
                  <th className={th}>Kullanıcı</th>
                  <th className={th}>Tür</th>
                  <th className={th}>Plan</th>
                  <th className={`${th} text-right`}>Kredi</th>
                  <th className={`${th} text-right`}>Günlük hak</th>
                  <th className={`${th} text-right`}>Tasarım</th>
                  <th className={th}>Durum</th>
                  <th className={th}>Son görülme</th>
                </tr>
              }
            >
              {users.items.map((u) => (
                <tr key={u.id} className="hover:bg-surface-2">
                  <td className={td}>
                    <Link href={`/users/${encodeURIComponent(u.id)}`} className="font-medium text-fg hover:text-primary hover:underline">
                      {u.email ?? u.name ?? "Misafir kullanıcı"}
                    </Link>
                    <p className="font-mono text-[11px] text-muted-foreground">{u.id}</p>
                  </td>
                  <td className={td}>{u.isGuest ? <Badge>Misafir</Badge> : <Badge tone="primary">Kayıtlı</Badge>}</td>
                  <td className={td}>{u.plan === "PRO" ? <Badge tone="warn">PRO</Badge> : <Badge>Ücretsiz</Badge>}</td>
                  <td className={`${td} text-right`}>{fmtInt(u.credits)}</td>
                  <td className={`${td} text-right`}>{fmtInt(u.dailyFreeRemaining)}</td>
                  <td className={`${td} text-right`}>{fmtInt(u.designsCount)}</td>
                  <td className={td}>{u.status === "BANNED" ? <Badge tone="danger">Engelli</Badge> : <Badge tone="good">Aktif</Badge>}</td>
                  <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDateTime(u.lastSeenAt)}</td>
                </tr>
              ))}
            </Table>
            {users.error && <p className="pt-3 text-sm text-danger">{users.error.message}</p>}
            <LoadMore hasMore={Boolean(users.nextCursor)} loading={users.loadingMore} onClick={users.loadMore} />
          </div>
        )}
      </Card>
    </>
  );
}
