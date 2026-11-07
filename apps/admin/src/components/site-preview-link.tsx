"use client";

import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { ReasonDialog } from "@/components/reason-dialog";
import { badgeTone } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError, useApi } from "@/lib/api";
import type { SitePreviewInfo } from "@/lib/types";

const when = (iso: string) => new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });

/**
 * API.md §7.52: the staff link that opens the web site while it shows the maintenance page. The link is shown once,
 * right after it is made; a new one cancels the old one. ADMIN makes or cancels it with a reason (audited).
 */
export function SitePreviewLink({ writable }: { writable: boolean }) {
  const { toast } = useFeedback();
  const info = useApi<SitePreviewInfo>("/site-preview");
  const [url, setUrl] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"rotate" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const d = info.data;

  async function run(kind: "rotate" | "revoke", reason: string) {
    setBusy(true);
    try {
      if (kind === "rotate") {
        const out = await api<{ url: string }>("/site-preview", { method: "POST", body: { reason } });
        setUrl(out.url);
        toast("success", "Yeni önizleme bağlantısı hazır; eskisi artık açılmaz.");
      } else {
        await api("/site-preview/revoke", { method: "POST", body: { reason } });
        setUrl(null);
        toast("success", "Önizleme bağlantısı iptal edildi.");
      }
      setDialog(null);
      info.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border p-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">Personel önizleme bağlantısı</p>
        </div>
        {d ? d.active ? <Badge className={badgeTone.good}>Var</Badge> : <Badge className={badgeTone.neutral}>Yok</Badge> : <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      <p className="text-xs text-muted-foreground">
        Site bakımdayken bu bağlantıyı açan tarayıcı siteyi normal görür (7 gün). Bağlantı yalnız oluşturulduğu anda gösterilir; kaybedersen yenisini oluştur, eskisi
        hemen geçersiz olur.
        {d?.active && d.createdAt && ` Son bağlantı: ${when(d.createdAt)}${d.createdBy ? ` · ${d.createdBy.name || d.createdBy.email}` : ""}.`}
      </p>
      {url && (
        <div className="flex gap-2">
          <Input readOnly value={url} aria-label="Önizleme bağlantısı" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(url).then(() => toast("success", "Kopyalandı."))}>
            <Copy aria-hidden /> Kopyala
          </Button>
        </div>
      )}
      {writable && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setDialog("rotate")} disabled={!d}>
            <KeyRound aria-hidden /> {d?.active ? "Yeni bağlantı (eskisi geçersiz olur)" : "Bağlantı oluştur"}
          </Button>
          {d?.active && (
            <Button type="button" variant="ghost" className="text-danger" onClick={() => setDialog("revoke")}>
              <Trash2 aria-hidden /> İptal et
            </Button>
          )}
        </div>
      )}
      {dialog && (
        <ReasonDialog
          title={dialog === "rotate" ? "Yeni önizleme bağlantısı" : "Önizleme bağlantısını iptal et"}
          description={dialog === "rotate" ? "Varsa eski bağlantı hemen açılmaz olur; onunla girmiş tarayıcılar da bakım sayfasını görür." : "Bağlantıyla girmiş tarayıcılar da bakım sayfasını görmeye başlar."}
          confirmLabel={dialog === "rotate" ? "Oluştur" : "İptal et"}
          destructive={dialog === "revoke"}
          busy={busy}
          onConfirm={(reason) => void run(dialog, reason)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
