"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher, paths } from "@/lib/api";
import { compactMoney, money, num, pct, signColor } from "@/lib/format";
import type { Profile } from "@/lib/types";
import type { GlossaryKey } from "@/lib/glossary";
import { InfoTip } from "./InfoTip";
import { TickerSearch } from "./TickerSearch";
import { cx, ErrorBox } from "./ui";

/** Ticker kept in the URL (?ticker=AAPL) so pages are linkable. */
export function useTicker(): [string | null, (t: string) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ticker = params.get("ticker")?.toUpperCase() || null;
  return [ticker, (t: string) => router.push(`${pathname}?ticker=${encodeURIComponent(t)}`)];
}

const SECTIONS = [
  { id: "technical", label: "Technical" },
  { id: "fundamentals", label: "Fundamentals" },
  { id: "forecast", label: "Forecast" },
  { id: "backtest", label: "Backtest" },
];

export function StockHeader({ ticker, onTicker }: { ticker: string | null; onTicker: (t: string) => void }) {
  const { data: p, error } = useSWR<Profile>(ticker ? paths.profile(ticker) : null, fetcher, { revalidateOnFocus: false });
  const change = p?.price != null && p?.previous_close ? p.price / p.previous_close - 1 : null;

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <TickerSearch onSelect={onTicker} className="w-full max-w-sm" placeholder={ticker ? `Change ticker (${ticker})` : "Search a ticker…"} autoFocus={!ticker} />
        {ticker && (
          <div className="flex gap-1">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200">
                {s.label}
              </a>
            ))}
            <Link href={`/compare?tickers=${encodeURIComponent(ticker)}`} className="rounded-md px-3 py-1.5 text-sm text-sky-400 hover:bg-slate-800">
              Compare with…
            </Link>
          </div>
        )}
      </div>

      {ticker && <ErrorBox error={error} />}
      {ticker && p && (
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="font-mono text-2xl font-bold text-white">{p.symbol}</h1>
              <span className="text-slate-300">{p.long_name || p.name}</span>
            </div>
            <div className="text-xs text-slate-500">{[p.exchange, p.sector, p.industry, p.currency].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="tabular text-2xl font-semibold text-white">{money(p.price, p.currency)}</span>
            <span className={cx("tabular text-sm", signColor(change))}>{pct(change)}</span>
          </div>
          <dl className="tabular flex flex-wrap gap-x-6 gap-y-1 text-xs">
            {(
              [
                ["Mkt cap", compactMoney(p.market_cap, p.currency), "marketCap"],
                ["P/E", num(p.trailing_pe, 1), "pe"],
                ["Fwd P/E", num(p.forward_pe, 1), "forwardPe"],
                ["EPS (TTM)", num(p.trailing_eps), "epsTtm"],
                ["Beta", num(p.beta), "beta"],
                ["52w range", `${num(p.fifty_two_week_low)} – ${num(p.fifty_two_week_high)}`, "week52Range"],
              ] as [string, string, GlossaryKey][]
            ).map(([label, value, term]) => (
              <div key={label}>
                <dt className="flex items-center text-slate-500">
                  {label}
                  <InfoTip term={term} />
                </dt>
                <dd className="text-slate-200">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
