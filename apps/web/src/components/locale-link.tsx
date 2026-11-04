"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { useApp } from "./app-provider";

/** next/link that keeps the visitor's language: href="/studio" opens /en/studio on English pages. */
export default function Link({ href, ...rest }: ComponentProps<typeof NextLink>) {
  const { href: localize } = useApp();
  return <NextLink href={typeof href === "string" ? localize(href) : href} {...rest} />;
}
