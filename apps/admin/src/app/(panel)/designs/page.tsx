import type { Metadata } from "next";
import { DesignsView } from "@/components/designs-view";

export const metadata: Metadata = { title: "Tasarımlar" };

export default async function DesignsPage({ searchParams }: PageProps<"/designs">) {
  const sp = await searchParams;
  const userId = typeof sp.userId === "string" ? sp.userId.slice(0, 80) : "";
  return <DesignsView initialUserId={userId} />;
}
