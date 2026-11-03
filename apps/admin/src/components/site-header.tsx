"use client";

import { usePathname } from "next/navigation";
import { NAV, isActive } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader() {
  const pathname = usePathname();
  const current = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))).find((i) => isActive(pathname, i.href));

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur lg:px-6">
      <SidebarTrigger className="-ml-1" aria-label="Menüyü aç / kapat" />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
      <nav aria-label="Konum" className="flex min-w-0 items-center gap-1.5 text-sm">
        {current && current.href !== "/" && <span className="hidden text-muted-foreground sm:inline">{current.group} /</span>}
        <span className="truncate font-medium">{current?.label ?? "Yönetim paneli"}</span>
      </nav>
    </header>
  );
}
