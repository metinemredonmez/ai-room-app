"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Clock } from "lucide-react";
import type { ReactNode } from "react";
import { fmtDateTime, STATUS_LABELS, toolLabel } from "@/lib/format";
import type { Design } from "@/lib/types";
import { Badge, Thumb } from "./common";

export function StatusBadge({ status }: { status: Design["status"] }) {
  if (status === "SUCCEEDED")
    return (
      <Badge tone="good" icon={<CheckCircle2 className="h-3 w-3" aria-hidden />}>
        {STATUS_LABELS.SUCCEEDED}
      </Badge>
    );
  if (status === "FAILED")
    return (
      <Badge tone="danger" icon={<AlertTriangle className="h-3 w-3" aria-hidden />}>
        {STATUS_LABELS.FAILED}
      </Badge>
    );
  return (
    <Badge tone="warn" icon={<Clock className="h-3 w-3" aria-hidden />}>
      {STATUS_LABELS.PENDING}
    </Badge>
  );
}

export function DesignCard({
  design,
  styleName,
  subtitle,
  actions,
}: {
  design: Design;
  styleName?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const result = design.results[0];
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 p-2">
        <Thumb src={design.input?.url} alt="Önce: yüklenen fotoğraf" className="aspect-[4/3] w-full" />
        <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        {result ? (
          <Thumb src={result.url} alt="Sonra: üretilen tasarım" className="aspect-[4/3] w-full" />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-surface-2 text-center text-[11px] text-muted-foreground">
            Sonuç yok
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3 pb-3">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-medium text-fg">{design.title || toolLabel(design.tool)}</p>
          <StatusBadge status={design.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {toolLabel(design.tool)}
          {styleName ? ` · ${styleName}` : ""}
          {design.results.length > 1 ? ` · ${design.results.length} varyant` : ""}
        </p>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        {design.status === "FAILED" && design.error && <p className="line-clamp-2 text-xs text-danger">{design.error}</p>}
        <p className="text-[11px] text-muted-foreground">{fmtDateTime(design.createdAt)}</p>
        {actions && <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1.5">{actions}</div>}
      </div>
    </article>
  );
}
