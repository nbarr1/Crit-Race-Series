import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountNav, SignInLink } from "@/components/account-nav";
import { SERIES_NAME } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: SERIES_NAME, template: `%s | ${SERIES_NAME}` },
  description: "Criterium racing at Connestee Nature Park. Schedule, registration, results, and standings.",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Crit Series", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b4fa8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:p-3"
        >
          Skip to main content
        </a>
        <header className="border-b-2 border-border bg-primary text-primary-foreground">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2">
            <Link href="/" className="flex min-h-11 items-center text-lg font-bold">
              {SERIES_NAME}
            </Link>
            <nav aria-label="Main">
              <ul className="flex flex-wrap items-center gap-1 text-base font-semibold">
                <li>
                  <Link className="flex min-h-11 items-center rounded px-2 hover:underline" href="/schedule">
                    Schedule
                  </Link>
                </li>
                <Suspense fallback={<SignInLink />}>
                  <AccountNav />
                </Suspense>
              </ul>
            </nav>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-3xl px-4 py-6">
          {children}
        </main>
        <footer className="mx-auto max-w-3xl px-4 pb-8 pt-4 text-sm text-muted-foreground">
          <p>Times shown in Eastern Time.</p>
        </footer>
      </body>
    </html>
  );
}
