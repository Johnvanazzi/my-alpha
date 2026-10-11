"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/portfolios", label: "Portfolios" },
  { href: "/sharpe", label: "Sharpe Calculator" },
  { href: "/screener", label: "Screener" },
  { href: "/technical", label: "Technical" },
  { href: "/fundamentals", label: "Fundamentals" },
];

export function Nav() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 overflow-x-auto px-4 py-3">
        <Link href="/" className="shrink-0 text-lg font-bold tracking-tight text-white">
          my<span className="text-sky-400">α</span>
        </Link>
        <nav className="flex gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cx(
                "shrink-0 rounded-md px-3 py-1.5 text-sm transition",
                active(l.href) ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
