import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata = {
  title: "Top Conference Reading",
  description: "Browse ICLR / ICML / NeurIPS papers by research direction.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              📚 top-conference-reading
            </Link>
            <nav className="flex gap-4 text-sm text-zinc-600">
              <Link href="/" className="hover:text-zinc-900">Cloud</Link>
              <Link href="/venues" className="hover:text-zinc-900">Venues</Link>
              <Link href="/marks" className="hover:text-zinc-900">Saved</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
