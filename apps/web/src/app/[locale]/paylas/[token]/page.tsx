import type { Metadata } from "next";
import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { ShareView } from "./share-view";

// API.md §7.23 client sharing: a public before/after page behind a time-boxed token (fal-app share pattern).
// The og:image is rendered by the API (shareOg) so every crawler — including chat apps — gets the composite.

const API = (process.env.API_BASE_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");
const APP = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

type Shared = {
  title: string;
  tool: string;
  views: number;
  before: { id: string; url: string; width: number; height: number };
  after: { id: string; url: string; width: number; height: number } | null;
};

// Cached for a minute so the route prerenders and metadata builds without blocking; the API remains the
// source of truth for the view counter (the number on the page can lag behind by up to the cache life).
async function load(token: string): Promise<Shared | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`share:${token}`);
  if (!/^[A-Za-z0-9_-]{20,48}$/.test(token)) return null;
  try {
    const res = await fetch(`${API}/shared/${token}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()) as Shared;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const shared = await load(token);
  if (!shared) return { title: "Casalume" };
  return {
    title: `${shared.title} — Casalume`,
    description: "Yapay zekâ ile yeniden tasarlanmış oda: öncesi ve sonrası.",
    openGraph: {
      title: `${shared.title} — Casalume`,
      description: "Yapay zekâ ile yeniden tasarlanmış oda: öncesi ve sonrası.",
      images: [{ url: `${API}/shared/${token}/og.jpg`, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-4 py-10 sm:px-6" />}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await load(token);
  return <ShareView shared={shared} appUrl={APP} />;
}
