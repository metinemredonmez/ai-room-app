import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <p className="text-8xl font-display font-light text-primary/30">404</p>
      <h1 className="mt-4 text-3xl font-display font-light">Sayfa bulunamadı</h1>
      <p className="mt-2 text-sm text-muted">Page not found</p>
      <Link
        href="/"
        className="mt-8 inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-white hover:bg-primary-strong"
      >
        Ana sayfaya dön
      </Link>
    </div>
  );
}
