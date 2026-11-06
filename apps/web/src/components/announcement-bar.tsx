import { ArrowRight, Info, Megaphone, TriangleAlert } from "lucide-react";
import Link from "@/components/locale-link";
import type { Announcement } from "@/lib/site-content";

// The announcement bar from the admin (API.md §7.46), above the header on every page. Plain text; the link can only
// be one of our own pages (checked in lib/site-content.ts).

const TONES = {
  info: { cls: "bg-primary-soft text-primary-strong", Icon: Info },
  promo: { cls: "bg-primary text-white", Icon: Megaphone },
  warning: { cls: "bg-accent-soft text-text", Icon: TriangleAlert },
} as const;

export function AnnouncementBar({ announcement }: { announcement: Announcement | null }) {
  if (!announcement) return null;
  const { cls, Icon } = TONES[announcement.tone];
  const body = (
    <>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span>{announcement.text}</span>
      {announcement.link && <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />}
    </>
  );
  return (
    <div className={`${cls} text-sm`}>
      {announcement.link ? (
        <Link href={announcement.link} className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center font-medium underline-offset-4 hover:underline sm:px-6">
          {body}
        </Link>
      ) : (
        <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center font-medium sm:px-6">{body}</p>
      )}
    </div>
  );
}
