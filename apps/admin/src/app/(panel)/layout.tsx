import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg:flex">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
