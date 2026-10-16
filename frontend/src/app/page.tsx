"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { TickerSearch } from "@/components/TickerSearch";
import { Card, Empty, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { pct } from "@/lib/format";
import type { Portfolio } from "@/lib/types";

const SECTIONS = [
  { href: "/portfolios", title: "Portfolios", text: "Allocation, Sharpe and risk vs a benchmark, rolling metrics and drawdowns, and Hierarchical Risk Parity." },
  { href: "/screener", title: "Screener", text: "Filter stocks by sector, size, valuation and dividends, or use Yahoo presets." },
  { href: "/compare", title: "Compare Stocks", text: "Two to four stocks side by side: Sharpe, returns, benchmark beta/alpha/correlation, drawdowns and fundamentals." },
  { href: "/stocks", title: "Stock Analysis", text: "Candlesticks with scored indicators, plus revenue, gross profit, EBITDA and EPS from financial reports." },
];

export default function Home() {
  const router = useRouter();
  const { data: portfolios, error, isLoading } = useSWR<Portfolio[]>("/portfolios", fetcher);

  return (
    <>
      <PageHeader title="Overview" subtitle="Track your investments and research stocks with Yahoo Finance data." />

      <div className="mb-8 max-w-xl">
        <TickerSearch onSelect={(s) => router.push(`/stocks?ticker=${encodeURIComponent(s)}`)} placeholder="Jump to a stock: AAPL, Microsoft, PETR4.SA…" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Your portfolios" className="lg:col-span-1" actions={<Link href="/portfolios" className="text-xs text-sky-400 hover:underline">Manage</Link>}>
          {isLoading && <Spinner />}
          <ErrorBox error={error} />
          {portfolios?.length === 0 && <Empty>No portfolios yet. <Link href="/portfolios" className="text-sky-400 hover:underline">Create one</Link>.</Empty>}
          <ul className="divide-y divide-slate-800">
            {portfolios?.map((p) => (
              <li key={p.id}>
                <Link href={`/portfolios/${p.id}`} className="flex items-center justify-between py-2.5 hover:text-white">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-slate-500">
                    {p.holdings.length} holdings · {pct(p.total_weight, 0)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-slate-600">
              <h3 className="font-semibold text-white">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-400">{s.text}</p>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
