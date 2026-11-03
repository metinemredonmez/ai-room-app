import type { Metadata } from "next";
import { ClientOnly, PageSkeleton } from "@/components/client-only";
import { Studio } from "./studio";

export const metadata: Metadata = { title: "Stüdyo" };

export default function StudioPage() {
  return (
    <ClientOnly fallback={<PageSkeleton />}>
      <Studio />
    </ClientOnly>
  );
}
