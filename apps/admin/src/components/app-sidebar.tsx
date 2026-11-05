"use client";

import {
  Activity,
  ChevronsUpDown,
  Coins,
  CreditCard,
  Flag,
  House,
  LayoutGrid,
  WandSparkles,
  Cpu,
  ToggleRight,
  Ticket,
  UserPlus,
  Gift,
  Handshake,
  FileText,
  ListChecks,
  Megaphone,
  LogOut,
  Palette,
  Scale,
  ScrollText,
  SlidersHorizontal,
  Store,
  LifeBuoy,
  Share2,
  Send,
  ChartNoAxesColumn,
  ChartLine,
  Crown,
  Building,
  Package,
  Newspaper,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandMark } from "@/components/brand-mark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { onBadgesChanged, useApi } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/format";
import { isPalette, PALETTES, setPalette, type PaletteId } from "@/lib/palette";
import type { AdminMe, Page, ContentReport } from "@/lib/types";

type NavItem = { href: string; label: string; icon: LucideIcon; badge?: "openReports" | "kvkkDue" | "openSupport"; superAdminOnly?: boolean };

export const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Genel",
    items: [
      { href: "/", label: "Ana sayfa", icon: House },
      { href: "/analytics", label: "Analiz", icon: ChartLine },
    ],
  },
  {
    label: "İçerik",
    items: [
      { href: "/product", label: "Ürün kataloğu", icon: LayoutGrid },
      { href: "/designs", label: "Tasarımlar", icon: Sparkles },
      { href: "/reports", label: "İçerik bildirimleri", icon: Flag, badge: "openReports" },
      { href: "/styles", label: "Stiller", icon: Palette },
    ],
  },
  {
    label: "Yapay zekâ",
    items: [
      { href: "/prompts", label: "İstem şablonları", icon: WandSparkles },
      { href: "/ai-engine", label: "Model ve sağlayıcı", icon: Cpu },
    ],
  },
  {
    label: "Kullanıcılar",
    items: [
      { href: "/users", label: "Kullanıcılar", icon: Users },
      { href: "/orgs", label: "Firmalar", icon: Building },
      { href: "/support", label: "Destek", icon: LifeBuoy, badge: "openSupport" },
      { href: "/broadcasts", label: "Toplu Gönderim", icon: Megaphone },
    ],
  },
  {
    label: "Büyüme",
    items: [
      { href: "/promo", label: "Promosyon kodları", icon: Ticket },
      { href: "/referrals", label: "Davet programı", icon: UserPlus },
      { href: "/gifts", label: "Toplu hediye", icon: Gift },
      { href: "/partners", label: "Ortaklar", icon: Handshake },
    ],
  },
  {
    label: "Pazarlama",
    items: [
      { href: "/marketing/aso", label: "Mağaza metni", icon: Store },
      { href: "/marketing/social", label: "Sosyal medya", icon: Share2 },
      { href: "/marketing/campaign", label: "Kampanya metni", icon: Send },
      { href: "/marketing/blog", label: "Blog", icon: Newspaper },
      { href: "/marketing/seo", label: "SEO", icon: Search },
      { href: "/marketing/report", label: "Haftalık rapor", icon: ChartNoAxesColumn },
    ],
  },
  {
    label: "KVKK",
    items: [
      { href: "/data-requests", label: "KVKK başvuruları", icon: Scale, badge: "kvkkDue" },
      { href: "/legal", label: "Yasal metinler", icon: FileText },
    ],
  },
  {
    label: "Gelir ve maliyet",
    items: [
      { href: "/subscriptions", label: "Abonelikler", icon: Crown },
      { href: "/plans", label: "Planlar ve paketler", icon: Package },
      { href: "/billing", label: "Ödeme olayları", icon: CreditCard },
      { href: "/ai-costs", label: "AI maliyeti", icon: Coins },
    ],
  },
  {
    label: "Sistem",
    items: [
      { href: "/settings", label: "Ayarlar", icon: SlidersHorizontal },
      { href: "/features", label: "Özellikler", icon: ToggleRight },
      { href: "/jobs", label: "Zamanlı işler", icon: ListChecks },
      { href: "/audit", label: "Denetim kaydı", icon: ScrollText },
      { href: "/system", label: "Sistem durumu", icon: Activity },
      { href: "/admins", label: "Yöneticiler", icon: ShieldCheck, superAdminOnly: true },
    ],
  },
];

/** Pages reached from the account menu, for the header breadcrumb. */
export const EXTRA_PAGES = [{ href: "/account", label: "Hesabım", group: "Hesap" }];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const initials = (me: AdminMe | null) =>
  (me?.name ?? me?.email ?? "Y")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

export function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const me = useApi<AdminMe>("/me");
  const openReports = useApi<Page<ContentReport>>("/reports", { status: "OPEN", limit: 100 });
  const kvkk = useApi<{ counts: { dueSoon: number; overdue: number } }>("/data-requests", { limit: 1 });
  // KVKK: only applications that need action soon (due within 7 days or overdue).
  const support = useApi<{ counts: { OPEN: number } }>("/support", { status: "OPEN", limit: 1 });
  const badges = {
    openReports: openReports.data?.items.length ?? 0,
    kvkkDue: (kvkk.data?.counts.dueSoon ?? 0) + (kvkk.data?.counts.overdue ?? 0),
    openSupport: support.data?.counts.OPEN ?? 0,
  };
  const { reload: reloadReports } = openReports;
  const { reload: reloadKvkk } = kvkk;
  const { reload: reloadSupport } = support;
  useEffect(
    () =>
      onBadgesChanged(() => {
        reloadReports();
        reloadKvkk();
        reloadSupport();
      }),
    [reloadReports, reloadKvkk, reloadSupport],
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/" onClick={() => setOpenMobile(false)}>
                <BrandMark size={32} className="rounded-lg" />
                <span className="grid leading-tight">
                  <span className="truncate font-semibold">Casalume</span>
                  <span className="truncate text-xs text-muted-foreground">Yönetim paneli</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.filter((i) => !i.superAdminOnly || me.data?.role === "SUPER_ADMIN").map(({ href, label, icon: Icon, badge }) => {
                  const count = badge ? badges[badge] : 0;
                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton asChild isActive={isActive(pathname, href)} tooltip={label}>
                        <Link href={href} onClick={() => setOpenMobile(false)}>
                          <Icon aria-hidden />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {count > 0 && <SidebarMenuBadge aria-label={`${count} açık`}>{count >= 100 ? "99+" : count}</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu me={me.data ?? null} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function UserMenu({ me }: { me: AdminMe | null }) {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary-soft text-xs font-semibold text-primary">{initials(me)}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{me?.name ?? "Yönetici"}</span>
                <span className="truncate text-xs text-muted-foreground">{me ? ROLE_LABELS[me.role] ?? me.role : "—"}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56 rounded-lg" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
            <DropdownMenuLabel className="font-normal">
              <p className="truncate text-sm font-medium">{me?.name ?? "Yönetici"}</p>
              <p className="truncate text-xs text-muted-foreground">{me?.email ?? "—"}</p>
              {me?.mfa.required && !me.mfa.enrolled && <p className="mt-1 text-xs text-destructive">İki adımlı doğrulama kurulmamış</p>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account">
                <UserRound aria-hidden /> Hesabım
              </Link>
            </DropdownMenuItem>
            <PaletteMenu />
            <DropdownMenuItem onSelect={logout} disabled={loggingOut}>
              <LogOut aria-hidden /> Çıkış yap
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** "Panel rengi": the four colour themes; the cookie lets the server render the choice on the next page load. */
function PaletteMenu() {
  // Rendered only inside the opened menu (client), so the DOM can be read directly.
  const [active, setActive] = useState<PaletteId>(() => {
    const p = document.documentElement.dataset.palette;
    return isPalette(p) ? p : "kil";
  });
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Palette aria-hidden /> Panel rengi
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-44">
        <DropdownMenuRadioGroup
          value={active}
          onValueChange={(v) => {
            if (!isPalette(v)) return;
            setPalette(v);
            setActive(v);
          }}
        >
          {PALETTES.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id} onSelect={(e) => e.preventDefault()}>
              <span className="size-3.5 rounded-full ring-1 ring-black/10" style={{ background: p.swatch }} aria-hidden />
              {p.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
