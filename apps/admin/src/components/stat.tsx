"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export type StatTone = "primary" | "good" | "warn" | "danger" | "neutral";

const TONE: Record<StatTone, string> = {
  primary: "bg-primary-soft text-primary",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-secondary text-secondary-foreground",
};

/** KPI tile shared by the panel screens: label, icon chip, big number (skeleton while it loads), optional note. */
export function StatCard({
  icon: Icon,
  label,
  value,
  note,
  tone = "primary",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode | null | undefined;
  note?: ReactNode;
  tone?: StatTone;
}) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <span className={`flex size-8 items-center justify-center rounded-lg ${TONE[tone]}`}>
            <Icon className="size-4" aria-hidden />
          </span>
        </CardAction>
        {value == null ? <Skeleton className="h-8 w-24" /> : <CardTitle className="tabular text-3xl font-semibold">{value}</CardTitle>}
      </CardHeader>
      {note !== undefined && <CardContent className="text-xs text-muted-foreground">{note}</CardContent>}
    </Card>
  );
}

/** Tone classes for status badges, matching the stat chips. */
export const badgeTone = TONE;
