"use client";

import { KeyRound, MoreHorizontal, Search, ShieldCheck, ShieldOff, UserMinus, UserPlus, UserCog } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState, PageHeader, Spinner } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime, ROLE_LABELS } from "@/lib/format";
import { ADMIN_ROLES, type AdminMe, type AdminRole, type AdminTeamMember, type AdminUser, type Page } from "@/lib/types";

const ROLE_HINTS: Record<AdminRole, string> = {
  SUPPORT: "Okur; kullanıcı ve içerik bildirimlerine bakar",
  EDITOR: "Stil kataloğunu ve öne çıkanları düzenler",
  ADMIN: "Ayarlar, krediler, KVKK ve yasal metinler",
  SUPER_ADMIN: "Her şey; yönetici ekibini de yönetir",
};

type Action = { kind: "role"; member: AdminTeamMember } | { kind: "remove"; member: AdminTeamMember } | { kind: "mfa"; member: AdminTeamMember } | { kind: "add" };

const initials = (m: { name: string | null; email: string | null }) =>
  (m.name ?? m.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

export default function AdminsPage() {
  const me = useApi<AdminMe>("/me");
  const team = useApi<{ items: AdminTeamMember[] }>("/admins");
  const [action, setAction] = useState<Action | null>(null);

  if (team.error?.status === 403) {
    return (
      <>
        <PageHeader title="Yönetici ekibi" />
        <EmptyState title="Bu sayfa yalnız süper yöneticiye açık" description="Rol vermek ve MFA sıfırlamak için süper yönetici yetkisi gerekir." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Yönetici ekibi"
        description="Roller, iki adımlı doğrulama durumu ve son görülme. Her değişiklik gerekçesiyle denetim kaydına girer; kişiye e-posta gider."
        actions={
          <Button onClick={() => setAction({ kind: "add" })}>
            <UserPlus aria-hidden /> Yönetici ekle
          </Button>
        }
      />

      {team.error && !team.data ? (
        <ErrorState message={team.error.message} onRetry={team.reload} />
      ) : !team.data ? (
        <Spinner />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Kişi</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>İki adımlı doğrulama</TableHead>
                <TableHead className="text-right">Yedek kod</TableHead>
                <TableHead>Son görülme</TableHead>
                <TableHead className="w-12 pr-6" aria-label="İşlemler" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.data.items.map((m) => {
                const self = m.id === me.data?.id;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8 rounded-lg">
                          <AvatarFallback className="rounded-lg bg-primary-soft text-xs font-semibold text-primary">{initials(m)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {m.name ?? "—"} {self && <span className="text-xs font-normal text-muted-foreground">(sen)</span>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.role === "SUPER_ADMIN" ? "default" : "secondary"}>{ROLE_LABELS[m.role]}</Badge>
                    </TableCell>
                    <TableCell>
                      <MfaStatus member={m} />
                    </TableCell>
                    <TableCell className="tabular text-right">{m.mfa.enrolled ? m.mfa.backupCodesRemaining : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDateTime(m.lastSeenAt)}</TableCell>
                    <TableCell className="pr-6">
                      {self ? (
                        <span className="sr-only">Kendi hesabın değiştirilemez</span>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`${m.name ?? m.email} için işlemler`}>
                              <MoreHorizontal aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setAction({ kind: "role", member: m })}>
                              <UserCog aria-hidden /> Rolü değiştir
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setAction({ kind: "mfa", member: m })}>
                              <KeyRound aria-hidden /> MFA’yı sıfırla
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setAction({ kind: "remove", member: m })}>
                              <UserMinus aria-hidden /> Yöneticilikten çıkar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {action?.kind === "add" && <AddAdminDialog onClose={() => setAction(null)} onDone={team.reload} />}
      {action && action.kind !== "add" && <MemberDialog action={action} onClose={() => setAction(null)} onDone={team.reload} />}
    </>
  );
}

function MfaStatus({ member }: { member: AdminTeamMember }) {
  if (member.mfa.enrolled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-good">
        <ShieldCheck className="size-4" aria-hidden /> Kurulu
      </span>
    );
  }
  if (member.mfa.enrollBefore && new Date(member.mfa.enrollBefore) > new Date()) {
    return <span className="text-sm text-warn">Kayıt bekliyor · son {fmtDateTime(member.mfa.enrollBefore)}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-danger">
      <ShieldOff className="size-4" aria-hidden /> Kurulmadı
    </span>
  );
}

function RoleSelect({ value, onChange, id }: { value: AdminRole | ""; onChange: (r: AdminRole) => void; id: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AdminRole)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Rol seç" />
      </SelectTrigger>
      <SelectContent>
        {ADMIN_ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            <span className="font-medium">{ROLE_LABELS[r]}</span>
            <span className="text-xs text-muted-foreground">{ROLE_HINTS[r]}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="reason">Gerekçe</Label>
      <Textarea id="reason" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Örn. destek ekibine katıldı" maxLength={300} rows={3} />
      <p className="text-xs text-muted-foreground">En az 5 karakter; denetim kaydına girer.</p>
    </div>
  );
}

function MemberDialog({ action, onClose, onDone }: { action: Exclude<Action, { kind: "add" }>; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const m = action.member;
  const [role, setRole] = useState<AdminRole | "">(m.role === "USER" ? "" : m.role);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = {
    role: { title: "Rolü değiştir", description: "Kişinin açık oturumları kapanır; yeni rolle tekrar giriş yapar.", cta: "Rolü kaydet" },
    remove: { title: "Yöneticilikten çıkar", description: "Kişi normal kullanıcıya döner ve yönetim paneline giremez.", cta: "Çıkar" },
    mfa: { title: "MFA'yı sıfırla", description: "Doğrulayıcı ve yedek kodlar silinir; kişi 72 saat içinde yeniden kayıt olmalı. Oturumları kapanır.", cta: "Sıfırla" },
  }[action.kind];

  async function submit() {
    setBusy(true);
    try {
      if (action.kind === "mfa") await api(`/admins/${m.id}/mfa-reset`, { method: "POST", body: { reason } });
      else await api(`/admins/${m.id}`, { method: "PATCH", body: { role: action.kind === "remove" ? "USER" : role, reason } });
      toast("success", action.kind === "mfa" ? "MFA sıfırlandı." : action.kind === "remove" ? "Yöneticilikten çıkarıldı." : "Rol güncellendi.");
      onDone();
      onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem başarısız.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {m.name ?? m.email} · {copy.description}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {action.kind === "role" && (
            <div className="grid gap-2">
              <Label htmlFor="role">Yeni rol</Label>
              <RoleSelect id="role" value={role} onChange={setRole} />
            </div>
          )}
          <ReasonField value={reason} onChange={setReason} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            variant={action.kind === "role" ? "default" : "destructive"}
            disabled={busy || reason.trim().length < 5 || (action.kind === "role" && (!role || role === m.role))}
            onClick={submit}
          >
            {copy.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddAdminDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<AdminUser | null>(null);
  const [role, setRole] = useState<AdminRole | "">("SUPPORT");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const results = useApi<Page<AdminUser>>(search.length >= 2 ? "/users" : null, { q: search, limit: 8 });
  const candidates = (results.data?.items ?? []).filter((u) => !u.isGuest && u.role === "USER" && u.email);

  async function submit() {
    if (!picked || !role) return;
    setBusy(true);
    try {
      await api(`/admins/${picked.id}`, { method: "PATCH", body: { role, reason } });
      toast("success", `${picked.name ?? picked.email} yönetici yapıldı; 72 saat içinde doğrulayıcısını kurmalı.`);
      onDone();
      onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem başarısız.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yönetici ekle</DialogTitle>
          <DialogDescription>E-postasını doğrulamış kayıtlı bir kullanıcıya rol ver. Kişiye e-posta gider; ilk girişte doğrulayıcısını kurar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {picked ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{picked.name ?? "—"}</p>
                <p className="truncate text-xs text-muted-foreground">{picked.email}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                Değiştir
              </Button>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="user-search">Kullanıcı</Label>
              <form
                className="relative"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearch(q.trim());
                }}
              >
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id="user-search" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setSearch(q.trim())} placeholder="Ad ya da e-posta, Enter" className="pl-9" />
              </form>
              {search.length >= 2 && (
                <ul className="max-h-56 overflow-y-auto rounded-lg border" aria-label="Arama sonuçları">
                  {!results.data ? (
                    <li className="p-3 text-sm text-muted-foreground">Aranıyor…</li>
                  ) : candidates.length === 0 ? (
                    <li className="p-3 text-sm text-muted-foreground">Uygun kullanıcı bulunamadı (misafirler ve mevcut yöneticiler listelenmez).</li>
                  ) : (
                    candidates.map((u) => (
                      <li key={u.id}>
                        <button type="button" onClick={() => setPicked(u)} className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted">
                          <span className="text-sm font-medium">{u.name ?? "—"}</span>
                          <span className="text-xs text-muted-foreground">{u.email}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="new-role">Rol</Label>
            <RoleSelect id="new-role" value={role} onChange={setRole} />
          </div>
          <ReasonField value={reason} onChange={setReason} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={busy || !picked || !role || reason.trim().length < 5} onClick={submit}>
            Yönetici yap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
