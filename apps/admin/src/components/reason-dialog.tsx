"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Asks for the audit reason of an admin action (3–200 characters) instead of window.prompt. */
export function ReasonDialog({
  title,
  description,
  confirmLabel = "Onayla",
  destructive,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok && !busy) onConfirm(reason.trim());
          }}
        >
          <Label htmlFor="reason-dialog-text">Gerekçe (denetim kaydına yazılır)</Label>
          <Textarea id="reason-dialog-text" rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <p className="text-xs text-muted-foreground">En az 3 karakter · {reason.length}/200</p>
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Vazgeç
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={!ok || busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
