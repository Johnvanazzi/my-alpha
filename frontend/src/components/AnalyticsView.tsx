"use client";

import Link from "next/link";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num, pct, signColor } from "@/lib/format";
import type { Analytics } from "@/lib/types";
import { Card, Stat } from "./ui";

export const tooltipStyle = {
  contentStyle: { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#94a3b8" },
};

export function sharpeColor(v: number | null | undefined) {
  if (v == null) return "";
  if (v >= 1) return "text-emerald-400";
  if (v >= 0) return "text-amber-300";
  return "text-rose-400";
}

export function PortfolioStats({ a }: { a: Analytics }) {
  const p = a.portfolio;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Stat label="Sharpe ratio" value={num(p.sharpe_ratio)} className={sharpeColor(p.sharpe_ratio)} hint={a.benchmark ? `${a.benchmark.ticker}: ${num(a.benchmark.sharpe_ratio)}` : undefined} />
      <Stat label="Annual return" value={pct(p.annual_return)} className={signColor(p.annual_return)} hint={`Total ${pct(p.total_return)}`} />
      <Stat label="Volatility" value={pct(p.annual_volatility)} hint="Annualised std. dev." />
      <Stat label="Sortino ratio" value={num(p.sortino_ratio)} hint="Downside risk only" />
      <Stat label="Max drawdown" value={pct(p.max_drawdown)} className="text-rose-400" />
      <Stat label={`Beta vs ${a.benchmark?.ticker ?? "SPY"}`} value={num(a.benchmark?.portfolio_beta)} hint={`Risk-free ${pct(a.risk_free_rate)}`} />
    </div>
  );
}

export function GrowthChart({ a }: { a: Analytics }) {
  return (
    <Card title={`Growth of 100 · ${a.start} → ${a.end}`}>
      <div className="h-72">
        <ResponsiveContainer>
          <LineChart data={a.growth} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} minTickGap={50} />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} domain={["auto", "auto"]} width={45} />
            <Tooltip {...tooltipStyle} formatter={(v) => num(v as number)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="portfolio" name="Portfolio" stroke="#38bdf8" dot={false} strokeWidth={2} />
            {a.benchmark && <Line type="monotone" dataKey="benchmark" name={a.benchmark.ticker} stroke="#94a3b8" dot={false} strokeWidth={1.5} strokeDasharray="4 3" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function AssetTable({ a }: { a: Analytics }) {
  return (
    <Card title="Per-holding statistics">
      <div className="overflow-x-auto">
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
              <th className="pb-2 text-left font-medium">Ticker</th>
              <th className="pb-2 font-medium">Weight</th>
              <th className="pb-2 font-medium">Annual return</th>
              <th className="pb-2 font-medium">Volatility</th>
              <th className="pb-2 font-medium">Sharpe</th>
              <th className="pb-2 font-medium">Max DD</th>
              <th className="pb-2 font-medium" title="Share of portfolio variance coming from this holding">Risk contrib.</th>
            </tr>
          </thead>
          <tbody>
            {a.assets.map((s) => (
              <tr key={s.ticker} className="border-t border-slate-800 text-right">
                <td className="py-2 text-left font-mono">
                  <Link href={`/technical?ticker=${encodeURIComponent(s.ticker)}`} className="text-white hover:text-sky-300">
                    {s.ticker}
                  </Link>
                </td>
                <td>{pct(s.weight)}</td>
                <td className={signColor(s.annual_return)}>{pct(s.annual_return)}</td>
                <td>{pct(s.annual_volatility)}</td>
                <td className={sharpeColor(s.sharpe_ratio)}>{num(s.sharpe_ratio)}</td>
                <td>{pct(s.max_drawdown)}</td>
                <td>{pct(s.risk_contribution)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function corrColor(v: number | null) {
  if (v == null) return "transparent";
  // Blue for negative, red for positive correlation.
  const alpha = Math.min(Math.abs(v), 1) * 0.75;
  return v >= 0 ? `rgba(244, 63, 94, ${alpha})` : `rgba(56, 189, 248, ${alpha})`;
}

export function CorrelationMatrix({ a }: { a: Analytics }) {
  const { tickers, matrix } = a.correlation;
  if (tickers.length < 2) return null;
  return (
    <Card title="Correlation of daily returns">
      <div className="overflow-x-auto">
        <table className="tabular text-xs">
          <thead>
            <tr>
              <th />
              {tickers.map((t) => (
                <th key={t} className="px-2 pb-1 font-mono font-medium text-slate-400">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={tickers[i]}>
                <th className="pr-2 text-right font-mono font-medium text-slate-400">{tickers[i]}</th>
                {row.map((v, j) => (
                  <td key={j} className="h-9 min-w-14 px-2 text-center text-slate-100" style={{ background: corrColor(v) }}>
                    {num(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
