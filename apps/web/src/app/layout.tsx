import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
import { UserBadge } from "@/components/user-badge";

export const metadata = {
  title: "Top Conference Reading",
  description: "Browse ICLR / ICML / NeurIPS papers by research direction.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        suppressHydrationWarning
        className="min-h-screen bg-zinc-50 text-zinc-900 antialiased"
      >
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-2.5 sm:px-6 sm:gap-3">
            <Link
              href="/"
              className="shrink-0 text-base font-semibold tracking-tight sm:text-lg"
              title="top-conference-reading"
            >
              <span className="sm:hidden">📚 TCR</span>
              <span className="hidden sm:inline">📚 top-conference-reading</span>
            </Link>
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <nav className="flex gap-2 text-sm text-zinc-600 sm:gap-4">
                <Link href="/" className="hover:text-zinc-900">Cloud</Link>
                <Link href="/venues" className="hover:text-zinc-900">Venues</Link>
                <Link href="/marks" className="hover:text-zinc-900">Saved</Link>
              </nav>
              <UserBadge />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">{children}</main>
      </body>
    </html>
  );
}
