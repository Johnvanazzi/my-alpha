"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import useSWR from "swr";
import { sharpeColor, tooltipStyle } from "@/components/AnalyticsView";
import { BenchmarkPicker } from "@/components/BenchmarkPicker";
import { InfoTip, Term } from "@/components/InfoTip";
import { scoreColor } from "@/components/ScoreCard";
import { TickerSearch } from "@/components/TickerSearch";
import { Button, Card, cx, Empty, ErrorBox, Input, PageHeader, Segmented, Spinner } from "@/components/ui";
import { fetcher, paths } from "@/lib/api";
import { compactMoney, money, num, pct, PERIODS, signColor } from "@/lib/format";
import type { GlossaryKey } from "@/lib/glossary";
import type { CompareResult, CompareStock, FundamentalPeriod, TickerRow } from "@/lib/types";

const COLORS = ["#38bdf8", "#f59e0b", "#34d399", "#f472b6"];
const BENCH_COLOR = "#94a3b8";
const axisTick = { fill: "#64748b", fontSize: 11 };
const COMPARE_PERIODS = PERIODS.filter((p) => ["3mo", "6mo", "ytd", "1y", "2y", "5y", "10y"].includes(p.value));

type Better = "higher" | "lower" | null;

interface MetricRow<T> {
  label: string;
  term?: GlossaryKey;
  value: (s: T) => number | null | undefined;
  format: (v: number | null | undefined, s: T) => string;
  better: Better;
  colored?: boolean;
}

/** Index of the best value in a row, or -1 when there's nothing to compare. */
function bestIndex(values: (number | null | undefined)[], better: Better) {
  if (!better) return -1;
  const valid = values.map((v, i) => [v, i] as const).filter((x): x is readonly [number, number] => x[0] != null && Number.isFinite(x[0]));
  if (valid.length < 2) return -1;
  return valid.reduce((best, cur) => ((better === "higher" ? cur[0] > best[0] : cur[0] < best[0]) ? cur : best))[1];
}

function ComparisonTable<T>({ items, headers, rows, extra }: { items: T[]; headers: React.ReactNode[]; rows: MetricRow<T>[]; extra?: { header: React.ReactNode; cell: (r: MetricRow<T>) => React.ReactNode } }) {
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
            <th className="pb-2 text-left font-medium">Metric</th>
            {headers.map((h, i) => (
              <th key={i} className="pb-2 font-medium">
                {h}
              </th>
            ))}
            {extra && <th className="pb-2 font-medium">{extra.header}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const values = items.map(r.value);
            const best = bestIndex(values, r.better);
            return (
              <tr key={r.label} className="border-t border-slate-800 text-right">
                <td className="py-2 text-left text-slate-300">{r.term ? <Term term={r.term}>{r.label}</Term> : r.label}</td>
                {items.map((s, i) => (
                  <td key={i} className={cx(r.colored && signColor(values[i]), i === best && "font-semibold")}>
                    {i === best && <span className="mr-1 text-emerald-400" title="Best of the compared stocks">●</span>}
                    {r.format(values[i], s)}
                  </td>
                ))}
                {extra && <td className="text-slate-500">{extra.cell(r)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const RISK_ROWS: MetricRow<CompareStock["stats"]>[] = [
  { label: "Total return", term: "totalReturn", value: (s) => s.total_return, format: (v) => pct(v), better: "higher", colored: true },
  { label: "Annual return", term: "annualReturn", value: (s) => s.annual_return, format: (v) => pct(v), better: "higher", colored: true },
  { label: "Volatility", term: "volatility", value: (s) => s.annual_volatility, format: (v) => pct(v), better: "lower" },
  { label: "Sharpe ratio", term: "sharpe", value: (s) => s.sharpe_ratio, format: (v) => num(v), better: "higher" },
  { label: "Sortino ratio", term: "sortino", value: (s) => s.sortino_ratio, format: (v) => num(v), better: "higher" },
  { label: "Max drawdown", term: "maxDrawdown", value: (s) => s.max_drawdown, format: (v) => pct(v), better: "higher" },
];

const BENCH_ROWS: MetricRow<CompareStock["stats"]>[] = [
  { label: "Beta", term: "beta", value: (s) => s.beta, format: (v) => num(v), better: null },
  { label: "Correlation", term: "benchmarkCorrelation", value: (s) => s.correlation, format: (v) => num(v), better: null },
  { label: "R²", term: "rSquared", value: (s) => s.r_squared, format: (v) => num(v), better: null },
  { label: "Alpha (annual)", term: "alpha", value: (s) => s.alpha, format: (v) => pct(v), better: "higher", colored: true },
  { label: "Tracking error", term: "trackingError", value: (s) => s.tracking_error, format: (v) => pct(v), better: null },
];

const FUNDAMENTAL_ROWS: MetricRow<CompareStock>[] = [
  { label: "Market cap", term: "marketCap", value: (s) => s.profile.market_cap, format: (v, s) => compactMoney(v, s.profile.currency), better: null },
  { label: "P/E (TTM)", term: "pe", value: (s) => s.profile.trailing_pe, format: (v) => num(v, 1), better: "lower" },
  { label: "Forward P/E", term: "forwardPe", value: (s) => s.profile.forward_pe, format: (v) => num(v, 1), better: "lower" },
  { label: "EPS (TTM)", term: "epsTtm", value: (s) => s.profile.trailing_eps, format: (v, s) => money(v, s.profile.currency), better: null },
  { label: "Revenue (TTM)", term: "revenue", value: (s) => s.profile.revenue_ttm, format: (v, s) => compactMoney(v, s.profile.currency), better: null },
  { label: "EBITDA (TTM)", term: "ebitda", value: (s) => s.profile.ebitda_ttm, format: (v, s) => compactMoney(v, s.profile.currency), better: null },
  { label: "Gross margin", term: "grossMargin", value: (s) => s.profile.gross_margin, format: (v) => pct(v, 1), better: "higher" },
  { label: "EBITDA margin", term: "ebitdaMargin", value: (s) => s.profile.ebitda_margin, format: (v) => pct(v, 1), better: "higher" },
  { label: "Net margin", term: "netMargin", value: (s) => s.profile.profit_margin, format: (v) => pct(v, 1), better: "higher" },
  { label: "Revenue growth (YoY)", term: "revenueGrowth", value: (s) => s.profile.revenue_growth, format: (v) => pct(v, 1), better: "higher", colored: true },
  { label: "Earnings growth (YoY)", term: "epsGrowth", value: (s) => s.profile.earnings_growth, format: (v) => pct(v, 1), better: "higher", colored: true },
  { label: "Dividend yield", term: "dividendYield", value: (s) => s.profile.dividend_yield, format: (v) => (v == null ? "—" : `${num(v)}%`), better: "higher" },
  { label: "Beta (5y, Yahoo)", term: "beta", value: (s) => s.profile.beta, format: (v) => num(v), better: null },
];

/** One series per ticker; ticker symbols can contain "." so use accessor functions, not string paths. */
function TickerLines({ tickers, colors, dashedLast }: { tickers: string[]; colors: string[]; dashedLast?: boolean }) {
  return (
    <>
      {tickers.map((t, i) => (
        <Line
          key={t}
          dataKey={(r: TickerRow) => r[t]}
          name={t}
          stroke={colors[i]}
          dot={false}
          strokeWidth={dashedLast && i === tickers.length - 1 ? 1.5 : 2}
          strokeDasharray={dashedLast && i === tickers.length - 1 ? "4 3" : undefined}
          isAnimationActive={false}
        />
      ))}
    </>
  );
}

function ChartCard({ title, term, children, height = "h-72" }: { title: string; term?: GlossaryKey; children: React.ReactElement; height?: string }) {
  return (
    <Card title={title} term={term} className="min-w-0">
      <div className={height}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </Card>
  );
}

/** Annual fundamentals per fiscal year, one column per ticker (fiscal year ends may differ). */
function annualRows(stocks: CompareStock[], key: string): Record<string, number | string | null>[] {
  const byYear = new Map<string, Record<string, number | string | null>>();
  for (const s of stocks) {
    for (const p of s.fundamentals?.periods ?? ([] as FundamentalPeriod[])) {
      const year = `FY${p.period.slice(0, 4)}`;
      const row = byYear.get(year) ?? { year };
      row[s.ticker] = (p[key] as number | null) ?? null;
      byYear.set(year, row);
    }
  }
  return [...byYear.values()].sort((a, b) => String(a.year).localeCompare(String(b.year)));
}

function AnnualChart({ stocks, metric, title, term }: { stocks: CompareStock[]; metric: string; title: string; term: GlossaryKey }) {
  const rows = useMemo(() => annualRows(stocks, metric), [stocks, metric]);
  if (!rows.length) return null;
  return (
    <ChartCard title={title} term={term} height="h-56">
      <BarChart data={rows} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#1e293b" vertical={false} />
        <XAxis dataKey="year" tick={axisTick} />
        <YAxis tick={axisTick} width={45} tickFormatter={(v) => pct(v, 0)} />
        <ReferenceLine y={0} stroke="#334155" />
        <Tooltip {...tooltipStyle} cursor={{ fill: "#1e293b" }} formatter={(v) => pct(v as number, 1)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {stocks.map((s, i) => (
          <Bar key={s.ticker} dataKey={(r: Record<string, number | null>) => r[s.ticker]} name={s.ticker} fill={COLORS[i]} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ChartCard>
  );
}

function CorrelationGrid({ data }: { data: CompareResult["correlation"] }) {
  const color = (v: number | null) => (v == null ? "transparent" : v >= 0 ? `rgba(244, 63, 94, ${Math.min(Math.abs(v), 1) * 0.75})` : `rgba(56, 189, 248, ${Math.min(Math.abs(v), 1) * 0.75})`);
  return (
    <table className="tabular text-xs">
      <thead>
        <tr>
          <th />
          {data.tickers.map((t) => (
            <th key={t} className="px-2 pb-1 font-mono font-medium text-slate-400">
              {t}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.matrix.map((row, i) => (
          <tr key={data.tickers[i]}>
            <th className="pr-2 text-right font-mono font-medium text-slate-400">{data.tickers[i]}</th>
            {row.map((v, j) => (
              <td key={j} className="h-10 min-w-16 border border-slate-950 px-2 text-center text-slate-100" style={{ background: color(v) }} title={`${data.tickers[i]} × ${data.tickers[j]}`}>
                {num(v)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompareView() {
  const params = useSearchParams();
  const router = useRouter();
  const tickers = useMemo(() => [...new Set(params.getAll("tickers").map((t) => t.toUpperCase()).filter(Boolean))].slice(0, 4), [params]);
  const [period, setPeriod] = useState("1y");
  const [benchmark, setBenchmark] = useState("SPY");
  const [rfInput, setRfInput] = useState("");
  const rfParsed = rfInput.trim() === "" ? null : parseFloat(rfInput) / 100;
  const rf = rfParsed != null && !isNaN(rfParsed) ? rfParsed : null;

  const setTickers = (next: string[]) => {
    const qs = next.map((t) => `tickers=${encodeURIComponent(t)}`).join("&");
    router.replace(`/compare${qs ? `?${qs}` : ""}`);
  };
  const setSlot = (i: number, t: string) => {
    const next = [...tickers];
    next[i] = t.toUpperCase();
    setTickers([...new Set(next.filter(Boolean))]);
  };

  const ready = tickers.length >= 2;
  const { data, error, isLoading, isValidating } = useSWR<CompareResult>(ready ? paths.compare(tickers, period, benchmark, rf) : null, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  const lineTickers = data ? [...data.tickers, ...(data.benchmark ? [data.benchmark] : [])] : [];
  const lineColors = data ? [...data.tickers.map((_, i) => COLORS[i]), BENCH_COLOR] : [];
  const currencies = data ? [...new Set(data.stocks.map((s) => s.profile.currency).filter(Boolean))] : [];
  const slots = Math.min(4, Math.max(2, tickers.length + (tickers.length >= 2 && tickers.length < 4 ? 1 : 0)));

  return (
    <>
      <PageHeader title="Compare Stocks" subtitle="Risk, return, benchmark relationship and fundamentals side by side." />

      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          {Array.from({ length: slots }, (_, i) => (
            <div key={i} className="flex w-full max-w-72 flex-col gap-1">
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i] }} />
                {i < 2 ? `Stock ${i + 1}` : `Stock ${i + 1} (optional)`}
              </span>
              {tickers[i] ? (
                <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2">
                  <Link href={`/stocks?ticker=${encodeURIComponent(tickers[i])}`} className="font-mono text-sm font-semibold text-white hover:text-sky-300">
                    {tickers[i]}
                  </Link>
                  <span className="truncate text-xs text-slate-500">{data?.stocks.find((s) => s.ticker === tickers[i])?.profile.name}</span>
                  <button className="ml-auto text-slate-500 hover:text-slate-200" onClick={() => setTickers(tickers.filter((_, j) => j !== i))} aria-label={`Remove ${tickers[i]}`}>
                    ✕
                  </button>
                </div>
              ) : (
                <TickerSearch onSelect={(t) => setSlot(i, t)} placeholder="Search a ticker…" autoFocus={i === tickers.length && i < 2} />
              )}
            </div>
          ))}
          {tickers.length === 2 && (
            <Button size="sm" variant="ghost" onClick={() => setTickers([tickers[1], tickers[0]])} title="Swap the two stocks">
              ⇄ Swap
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Segmented options={COMPARE_PERIODS} value={period} onChange={setPeriod} />
          <BenchmarkPicker value={benchmark} onChange={setBenchmark} />
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <Term term="riskFree">Risk-free rate %</Term>
            <Input
              type="number"
              step="any"
              value={rfInput}
              onChange={(e) => setRfInput(e.target.value)}
              placeholder={data ? (data.risk_free_rate * 100).toFixed(2) : "T-bill"}
              className="w-24 py-1 text-right"
            />
          </label>
        </div>
      </div>

      {!ready && <Empty>Pick at least two stocks to compare.</Empty>}
      <ErrorBox error={error} />
      {ready && isLoading && !data && <Spinner label="Downloading prices and fundamentals…" />}

      {data && (
        <div className={cx("flex flex-col gap-6 transition", isValidating && "opacity-60")}>
          {data.benchmark_error && <p className="text-xs text-amber-400">{data.benchmark_error}</p>}
          <p className="text-xs text-slate-500">
            {data.observations} daily returns from {data.start} to {data.end}. ● marks the better value.
          </p>

          <div className={cx("grid gap-4", data.stocks.length === 2 ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-4")}>
            {data.stocks.map((s, i) => (
              <div key={s.ticker} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" style={{ borderTopColor: COLORS[i], borderTopWidth: 3 }}>
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/stocks?ticker=${encodeURIComponent(s.ticker)}`} className="font-mono text-lg font-bold text-white hover:text-sky-300">
                    {s.ticker}
                  </Link>
                  <span className="tabular text-lg text-white">{money(s.profile.price, s.profile.currency)}</span>
                </div>
                <div className="truncate text-sm text-slate-300">{s.profile.name}</div>
                <div className="text-xs text-slate-500">{[s.profile.sector, s.profile.industry, s.profile.exchange].filter(Boolean).join(" · ")}</div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="inline-flex items-center text-xs text-slate-400">
                    Technical score
                    <InfoTip term="technicalScore" />
                  </span>
                  <span className={cx("tabular font-semibold", scoreColor(s.technical?.score))}>
                    {s.technical?.score?.toFixed(1) ?? "—"} <span className="text-xs font-normal text-slate-500">/ 10 · {s.technical?.signal ?? "n/a"}</span>
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="inline-flex items-center text-xs text-slate-400">
                    Fundamental score
                    <InfoTip term="fundamentalScore" />
                  </span>
                  <span
                    className={cx("tabular font-semibold", scoreColor(s.fundamental_score?.score))}
                    title={s.fundamental_score?.groups.map((g) => `${g.label} ${g.score?.toFixed(1) ?? "—"}`).join(" · ")}
                  >
                    {s.fundamental_score?.score?.toFixed(1) ?? "—"} <span className="text-xs font-normal text-slate-500">/ 10</span>
                  </span>
                </div>
                {s.fundamental_score && (
                  <div className="mt-0.5 flex justify-end gap-2 text-[11px] text-slate-500">
                    {s.fundamental_score.groups.map((g) => (
                      <span key={g.id}>
                        {g.label} <span className={cx("tabular", scoreColor(g.score))}>{g.score?.toFixed(1) ?? "—"}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="inline-flex items-center text-xs text-slate-400">
                    Sharpe ({period})
                    <InfoTip term="sharpe" />
                  </span>
                  <span className={cx("tabular font-semibold", sharpeColor(s.stats.sharpe_ratio))}>{num(s.stats.sharpe_ratio)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Risk & return" className="min-w-0">
              <ComparisonTable
                items={data.stocks.map((s) => s.stats)}
                headers={data.tickers}
                rows={RISK_ROWS}
                extra={
                  data.benchmark_stats
                    ? {
                        header: data.benchmark,
                        cell: (r) => r.format(r.value(data.benchmark_stats as CompareStock["stats"]), data.benchmark_stats as CompareStock["stats"]),
                      }
                    : undefined
                }
              />
              <p className="mt-2 text-xs text-slate-500">Risk-free rate {pct(data.risk_free_rate)}.</p>
            </Card>
            {data.benchmark && (
              <Card title={`Relationship with ${data.benchmark}`} className="min-w-0">
                <ComparisonTable items={data.stocks.map((s) => s.stats)} headers={data.tickers} rows={BENCH_ROWS} />
              </Card>
            )}
          </div>

          <Card term="trailingReturns" title="Trailing returns">
            <div className="overflow-x-auto">
              <table className="tabular w-full text-sm">
                <thead>
                  <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 text-left font-medium">Stock</th>
                    {Object.keys(data.stocks[0].trailing_returns).map((k) => (
                      <th key={k} className="pb-2 font-medium">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.stocks.map((s, i) => (
                    <tr key={s.ticker} className="border-t border-slate-800 text-right">
                      <td className="py-2 text-left font-mono" style={{ color: COLORS[i] }}>
                        {s.ticker}
                      </td>
                      {Object.entries(s.trailing_returns).map(([k, v]) => {
                        const best = bestIndex(
                          data.stocks.map((x) => x.trailing_returns[k]),
                          "higher",
                        );
                        return (
                          <td key={k} className={cx(signColor(v), best === i && "font-semibold")}>
                            {pct(v, 1)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard title="Growth of 100" term="growth">
              <LineChart data={data.growth} syncId="compare" margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
                <YAxis tick={axisTick} width={45} domain={["auto", "auto"]} />
                <Tooltip {...tooltipStyle} formatter={(v) => num(v as number)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={100} stroke="#334155" />
                {TickerLines({ tickers: lineTickers, colors: lineColors, dashedLast: !!data.benchmark })}
              </LineChart>
            </ChartCard>
            <ChartCard title="Drawdown from peak" term="underwater">
              <AreaChart data={data.drawdown} syncId="compare" margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
                <YAxis tick={axisTick} width={45} tickFormatter={(v) => pct(v, 0)} domain={["dataMin", 0]} />
                <Tooltip {...tooltipStyle} formatter={(v) => pct(v as number)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {data.tickers.map((t, i) => (
                  <Area key={t} dataKey={(r: TickerRow) => r[t]} name={t} stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={0.12} isAnimationActive={false} />
                ))}
              </AreaChart>
            </ChartCard>
            {data.relative && (
              <ChartCard title={`Relative strength: ${data.tickers[0]} vs ${data.tickers[1]}`} term="relativeStrength">
                <LineChart data={data.relative} syncId="compare" margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
                  <YAxis tick={axisTick} width={45} domain={["auto", "auto"]} />
                  <Tooltip {...tooltipStyle} formatter={(v) => num(v as number)} />
                  <ReferenceLine y={100} stroke="#475569" strokeDasharray="4 3" />
                  <Line dataKey="value" name={`${data.tickers[0]} / ${data.tickers[1]}`} stroke="#a78bfa" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ChartCard>
            )}
            <ChartCard title={`Rolling correlation (${data.window} days)`} term="rollingCorrelation">
              <LineChart data={data.rolling_correlation} syncId="compare" margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
                <YAxis tick={axisTick} width={45} domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} />
                <Tooltip {...tooltipStyle} formatter={(v) => num(v as number)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#334155" />
                {data.pairs.map((p, i) => (
                  <Line
                    key={p.key}
                    dataKey={(r: TickerRow) => r[p.key]}
                    name={`${p.a} × ${p.b}`}
                    stroke={p.b === data.benchmark ? COLORS[data.tickers.indexOf(p.a)] : ["#a78bfa", "#fb7185", "#a3e635", "#fbbf24", "#22d3ee", "#e879f9"][i % 6]}
                    strokeDasharray={p.b === data.benchmark ? "4 3" : undefined}
                    dot={false}
                    strokeWidth={p.b === data.benchmark ? 1.5 : 2}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ChartCard>
          </div>

          <Card term="correlation" title="Correlation of daily returns">
            <CorrelationGrid data={data.correlation} />
          </Card>

          <section className="flex flex-col gap-6">
            <h2 className="border-b border-slate-800 pb-2 text-lg font-semibold text-white">Fundamentals</h2>
            {currencies.length > 1 && (
              <p className="text-xs text-amber-400">
                These stocks report in different currencies ({currencies.join(", ")}). Compare ratios, margins and growth rather than absolute amounts.
              </p>
            )}
            <Card title="Valuation & profitability (TTM)" className="min-w-0">
              <ComparisonTable items={data.stocks} headers={data.tickers} rows={FUNDAMENTAL_ROWS} />
            </Card>
            <div className="grid gap-6 xl:grid-cols-2">
              <AnnualChart stocks={data.stocks} metric="revenue_growth" title="Revenue growth by fiscal year" term="revenueGrowth" />
              <AnnualChart stocks={data.stocks} metric="eps_growth" title="EPS growth by fiscal year" term="epsGrowth" />
              <AnnualChart stocks={data.stocks} metric="gross_margin" title="Gross margin by fiscal year" term="grossMargin" />
              <AnnualChart stocks={data.stocks} metric="net_margin" title="Net margin by fiscal year" term="netMargin" />
            </div>
            {data.stocks.some((s) => !s.fundamentals) && (
              <p className="text-xs text-slate-500">
                No income statement for {data.stocks.filter((s) => !s.fundamentals).map((s) => s.ticker).join(", ")} (ETFs and indices have none).
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CompareView />
    </Suspense>
  );
}
