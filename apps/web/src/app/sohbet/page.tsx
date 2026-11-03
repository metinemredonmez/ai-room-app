import type { Metadata } from "next";
import { ClientOnly, PageSkeleton } from "@/components/client-only";
import { Chat } from "./chat";

export const metadata: Metadata = { title: "AI Sohbet" };

export default function ChatPage() {
  return (
    <ClientOnly fallback={<PageSkeleton />}>
      <Chat />
    </ClientOnly>
  );
}
