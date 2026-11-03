import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm text-muted">404</p>
      <h1 className="text-xl font-semibold text-fg">Sayfa bulunamadı</h1>
      <Link href="/" className="text-sm text-primary hover:underline">
        Gösterge paneline dön
      </Link>
    </main>
  );
}
