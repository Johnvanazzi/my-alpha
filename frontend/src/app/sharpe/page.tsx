"use client";

import { useState } from "react";
import useSWR from "swr";
import { AssetTable, GrowthChart, sharpeColor } from "@/components/AnalyticsView";
import { HoldingsEditor, type HoldingRow, toHoldings, toRows, validateRows } from "@/components/HoldingsEditor";
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Stat } from "@/components/ui";
import { api, fetcher, paths } from "@/lib/api";
import { num, pct, PERIODS, signColor } from "@/lib/format";
import type { Analytics, Portfolio } from "@/lib/types";

const DEFAULT_ROWS: HoldingRow[] = [
  { ticker: "SPY", weightPct: "60" },
  { ticker: "TLT", weightPct: "40" },
];

export default function SharpePage() {
  const [rows, setRows] = useState<HoldingRow[]>(DEFAULT_ROWS);
  const [period, setPeriod] = useState("1y");
  const [rfInput, setRfInput] = useState("");
  const [result, setResult] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const { data: riskFree } = useSWR<{ ticker: string; rate: number }>(paths.riskFree, fetcher, { revalidateOnFocus: false });
  const { data: portfolios } = useSWR<Portfolio[]>("/portfolios", fetcher);

  const validation = validateRows(rows) ?? (toHoldings(rows).length === 0 ? "Add at least one ticker." : null);

  const calculate = async () => {
    setLoading(true);
    setError(null);
    try {
      const rf = rfInput.trim() === "" ? null : parseFloat(rfInput) / 100;
      setResult(await api.sharpe({ holdings: toHoldings(rows), period, risk_free_rate: rf }));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const p = result?.portfolio;
  const excess = p?.annual_return != null && result ? p.annual_return - result.risk_free_rate : null;

  return (
    <>
      <PageHeader title="Sharpe Ratio Calculator" subtitle="Risk-adjusted return of any combination of tickers, using daily returns." />

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]">
        <div className="flex flex-col gap-6">
          <Card
            title="Inputs"
            actions={
              portfolios &&
              portfolios.length > 0 && (
                <Select
                  value=""
                  onChange={(e) => {
                    const chosen = portfolios.find((x) => x.id === Number(e.target.value));
                    if (chosen) setRows(toRows(chosen.holdings));
                  }}
                  className="py-1 text-xs"
                >
                  <option value="">Load portfolio…</option>
                  {portfolios.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              )
            }
          >
            <HoldingsEditor rows={rows} onChange={setRows} />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Lookback period">
                <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
                  {PERIODS.filter((x) => x.value !== "1mo").map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Risk-free rate % (annual)">
                <Input
                  type="number"
                  step="any"
                  value={rfInput}
                  onChange={(e) => setRfInput(e.target.value)}
                  placeholder={riskFree ? `${(riskFree.rate * 100).toFixed(2)} (T-bill)` : "13-week T-bill"}
                  className="text-right"
                />
              </Field>
            </div>
            {validation && <p className="mt-3 text-xs text-rose-400">{validation}</p>}
            <Button variant="primary" className="mt-4 w-full" onClick={calculate} disabled={loading || !!validation}>
              {loading ? "Calculating…" : "Calculate"}
            </Button>
          </Card>

          <Card title="How it is computed">
            <div className="space-y-2 text-sm text-slate-400">
              <p className="rounded bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">Sharpe = mean(rₚ − r_f) / σ(rₚ − r_f) × √252</p>
              <p>
                rₚ is the portfolio&apos;s daily return (weights rebalanced daily), r_f the daily equivalent of the annual risk-free rate, and 252 the
                number of trading days used to annualise.
              </p>
              <p>Rough reading: below 0 underperforms cash, 0–1 modest, 1–2 good, above 2 very good for the period measured.</p>
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {loading && <Spinner label="Downloading prices…" />}
          <ErrorBox error={error} />
          {!result && !loading && !error && (
            <div className="rounded-xl border border-dashed border-slate-800 px-6 py-16 text-center text-sm text-slate-500">
              Enter tickers and weights, then press Calculate.
            </div>
          )}
          {result && p && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="col-span-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 md:col-span-1 md:row-span-2">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Sharpe ratio</div>
                  <div className={`tabular mt-2 text-5xl font-bold ${sharpeColor(p.sharpe_ratio)}`}>{num(p.sharpe_ratio)}</div>
                  {result.benchmark && (
                    <div className="mt-2 text-xs text-slate-500">
                      {result.benchmark.ticker}: {num(result.benchmark.sharpe_ratio)}
                    </div>
                  )}
                </div>
                <Stat label="Annual return" value={pct(p.annual_return)} className={signColor(p.annual_return)} />
                <Stat label="Risk-free rate" value={pct(result.risk_free_rate)} />
                <Stat label="Excess return" value={pct(excess)} className={signColor(excess)} />
                <Stat label="Volatility" value={pct(p.annual_volatility)} />
                <Stat label="Sortino ratio" value={num(p.sortino_ratio)} />
                <Stat label="Max drawdown" value={pct(p.max_drawdown)} className="text-rose-400" />
              </div>
              <p className="text-xs text-slate-500">
                {result.observations} daily returns from {result.start} to {result.end}.
              </p>
              <GrowthChart a={result} />
              <AssetTable a={result} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
