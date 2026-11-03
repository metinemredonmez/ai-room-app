"use client";

import { Card, EmptyState, ErrorState, LoadMore, PageHeader, Spinner, Table, td, th } from "@/components/ui";
import { usePaged } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";

function metaText(meta: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(meta);
    return s === "{}" ? "—" : s.length > 300 ? `${s.slice(0, 300)}…` : s;
  } catch {
    return "—";
  }
}

export default function AuditPage() {
  const audit = usePaged<AuditEntry>("/audit", {});
  return (
    <>
      <PageHeader title="Denetim kaydı" description="Yönetici işlemleri: plan, kredi, durum, stil ve moderasyon değişiklikleri" />
      <Card>
        {audit.error && audit.items.length === 0 ? (
          <ErrorState message={audit.error.message} onRetry={audit.reload} />
        ) : audit.loading && audit.items.length === 0 ? (
          <Spinner />
        ) : audit.items.length === 0 ? (
          <EmptyState title="Kayıt yok" description="Yönetici işlemleri burada listelenir." />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th className={th}>Zaman</th>
                  <th className={th}>Yönetici</th>
                  <th className={th}>İşlem</th>
                  <th className={th}>Hedef</th>
                  <th className={th}>Ayrıntı</th>
                </tr>
              }
            >
              {audit.items.map((a) => (
                <tr key={a.id}>
                  <td className={`${td} whitespace-nowrap text-muted`}>{fmtDateTime(a.createdAt)}</td>
                  <td className={td}>{a.actorEmail ?? "—"}</td>
                  <td className={`${td} font-mono text-xs`}>{a.action}</td>
                  <td className={td}>
                    <span className="text-fg">{a.targetType}</span>
                    {a.targetId && <span className="ml-1 font-mono text-[11px] text-muted">{a.targetId}</span>}
                  </td>
                  <td className={`${td} max-w-md break-all font-mono text-[11px] text-muted`}>{metaText(a.meta)}</td>
                </tr>
              ))}
            </Table>
            {audit.error && <p className="pt-3 text-sm text-danger">{audit.error.message}</p>}
            <LoadMore hasMore={Boolean(audit.nextCursor)} loading={audit.loadingMore} onClick={audit.loadMore} />
          </>
        )}
      </Card>
    </>
  );
}
