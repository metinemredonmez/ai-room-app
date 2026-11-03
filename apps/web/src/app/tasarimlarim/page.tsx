import type { Metadata } from "next";
import { ClientOnly, PageSkeleton } from "@/components/client-only";
import { DesignsList } from "./designs-list";

export const metadata: Metadata = { title: "Tasarımlarım" };

export default function DesignsPage() {
  return (
    <ClientOnly fallback={<PageSkeleton />}>
      <DesignsList />
    </ClientOnly>
  );
}
