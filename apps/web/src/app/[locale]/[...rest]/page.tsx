import { notFound } from "next/navigation";

// The root layout lives under [locale], so an unmatched URL would get Next's bare 404. Catching it here renders
// [locale]/not-found.tsx inside the language's layout (header, footer, translated text).
export default function UnknownPage() {
  notFound();
}
