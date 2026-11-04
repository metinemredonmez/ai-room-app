"use client";

import Link from "@/components/locale-link";
import { useApp } from "@/components/app-provider";

export default function NotFound() {
  const { t } = useApp();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <p className="text-8xl font-display font-light text-primary/30">404</p>
      <h1 className="mt-4 text-3xl font-display font-light">{t.notFound.title}</h1>
      <Link
        href="/"
        className="mt-8 inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-white hover:bg-primary-strong"
      >
        {t.notFound.cta}
      </Link>
    </div>
  );
}
