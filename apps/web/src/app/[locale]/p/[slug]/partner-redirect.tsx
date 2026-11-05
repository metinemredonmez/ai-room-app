"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useApp } from "@/components/app-provider";
import { api } from "@/lib/api";
import { rememberVia } from "@/lib/attribution";

export function PartnerRedirect({ slug }: { slug: string }) {
  const { href } = useApp();
  const router = useRouter();
  const counted = useRef(false);
  useEffect(() => {
    rememberVia(slug);
    // The visit is counted once per page load (React may run effects twice in development), and nobody waits for it.
    if (!counted.current) {
      counted.current = true;
      void api.post(`/partners/${encodeURIComponent(slug)}/visit`).catch(() => undefined);
    }
    router.replace(href("/"));
  }, [slug, href, router]);
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <LoaderCircle className="h-6 w-6 animate-spin text-muted" aria-hidden />
    </div>
  );
}
