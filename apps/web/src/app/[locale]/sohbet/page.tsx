import { pageMetadata } from "@/lib/page-meta";
import { ClientOnly, PageSkeleton } from "@/components/client-only";
import { Chat } from "./chat";

export const generateMetadata = pageMetadata("chat");

export default function ChatPage() {
  return (
    <ClientOnly fallback={<PageSkeleton />}>
      <Chat />
    </ClientOnly>
  );
}
