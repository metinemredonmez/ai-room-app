import type { Metadata } from "next";
import { ClientOnly, PageSkeleton } from "@/components/client-only";
import { DesignDetail } from "./design-detail";

export const metadata: Metadata = { title: "Tasarım" };

export default function DesignPage() {
  return (
    <ClientOnly fallback={<PageSkeleton />}>
      <DesignDetail />
    </ClientOnly>
  );
}
