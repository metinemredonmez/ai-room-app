"use client";

import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A titled panel card. `flush` drops the side padding and puts a rule under the header, for a table that runs edge to
 * edge (cells then use pl-6 / pr-6 on the first and last column).
 */
export function Section({
  title,
  description,
  action,
  children,
  flush,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <Card className={`${flush ? "gap-0 pb-0" : ""} ${className ?? ""}`}>
      <CardHeader className={flush ? "border-b pb-4 [.border-b]:pb-4" : undefined}>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={flush ? "px-0" : undefined}>{children}</CardContent>
    </Card>
  );
}
