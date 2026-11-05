"use client";

import Link from "next/link";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num, PALETTE, pct, signColor } from "@/lib/format";
import type { Analytics, CategoryStats } from "@/lib/types";
import { Term } from "./InfoTip";
import { Card, Select, Stat } from "./ui";

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
      <Stat term="sharpe" label="Sharpe ratio" value={num(p.sharpe_ratio)} className={sharpeColor(p.sharpe_ratio)} hint={a.benchmark ? `${a.benchmark.ticker}: ${num(a.benchmark.sharpe_ratio)}` : undefined} />
      <Stat term="annualReturn" label="Annual return" value={pct(p.annual_return)} className={signColor(p.annual_return)} hint={a.benchmark ? `${a.benchmark.ticker}: ${pct(a.benchmark.annual_return)}` : `Total ${pct(p.total_return)}`} />
      <Stat term="volatility" label="Volatility" value={pct(p.annual_volatility)} hint={a.benchmark ? `${a.benchmark.ticker}: ${pct(a.benchmark.annual_volatility)}` : "Annualised std. dev."} />
      <Stat term="sortino" label="Sortino ratio" value={num(p.sortino_ratio)} hint={a.benchmark ? `${a.benchmark.ticker}: ${num(a.benchmark.sortino_ratio)}` : "Downside risk only"} />
      <Stat term="maxDrawdown" label="Max drawdown" value={pct(p.max_drawdown)} className="text-rose-400" hint={a.benchmark ? `${a.benchmark.ticker}: ${pct(a.benchmark.max_drawdown)}` : undefined} />
      <Stat term="beta" label={`Beta vs ${a.benchmark?.ticker ?? "benchmark"}`} value={num(a.benchmark?.portfolio_beta)} hint={`Risk-free ${pct(a.risk_free_rate)}`} />
    </div>
  );
}

const PORTFOLIO_VIEW = "portfolio";
const CONTRIBUTION_VIEW = "contribution";

/** Growth of 100 for the whole portfolio, one of its categories, or each category's contribution. */
export function GrowthChart({ a }: { a: Analytics }) {
  const [view, setView] = useState(PORTFOLIO_VIEW);
  const categories = a.categories ?? [];
  const category = categories.find((c) => c.key === view);
  // A category can disappear when the holdings change; fall back to the whole portfolio.
  const shown = category || view === CONTRIBUTION_VIEW ? view : PORTFOLIO_VIEW;

  return (
    <Card
      term="growth"
      title={`${shown === CONTRIBUTION_VIEW ? "Contribution to return" : "Growth of 100"} · ${a.start} → ${a.end}`}
      actions={
        categories.length > 1 && (
          <Select value={shown} onChange={(e) => setView(e.target.value)} className="py-1 text-xs" aria-label="Category">
            <option value={PORTFOLIO_VIEW}>Whole portfolio</option>
            <option value={CONTRIBUTION_VIEW}>Contribution by category</option>
            <optgroup label="Category">
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name} · {pct(c.weight, 0)}
                </option>
              ))}
            </optgroup>
          </Select>
        )
      }
    >
      {shown === CONTRIBUTION_VIEW ? <ContributionChart a={a} /> : <GrowthLines a={a} category={category} />}
    </Card>
  );
}

function GrowthLines({ a, category }: { a: Analytics; category?: CategoryStats }) {
  // Both series come from the same daily returns, so their rows line up by index.
  const data = category ? a.growth.map((row, i) => ({ ...row, category: a.category_growth[i]?.[category.key] ?? null })) : a.growth;
  return (
    <>
      <div className="h-72">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} minTickGap={50} />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} domain={["auto", "auto"]} width={45} />
            <Tooltip {...tooltipStyle} formatter={(v) => num(v as number)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {category && <Line type="monotone" dataKey="category" name={category.name} stroke="#38bdf8" dot={false} strokeWidth={2} />}
            <Line
              type="monotone"
              dataKey="portfolio"
              name="Portfolio"
              stroke={category ? "#a78bfa" : "#38bdf8"}
              dot={false}
              strokeWidth={category ? 1.5 : 2}
              strokeDasharray={category ? "2 2" : undefined}
            />
            {a.benchmark && <Line type="monotone" dataKey="benchmark" name={a.benchmark.ticker} stroke="#94a3b8" dot={false} strokeWidth={1.5} strokeDasharray="4 3" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {category && (
        <p className="mt-2 text-xs text-slate-400">
          {category.tickers.length} holdings ({category.tickers.map((t) => t.replace(/\.SA$/, "")).join(", ")}) · weight {pct(category.weight, 1)} · return{" "}
          <span className={signColor(category.total_return)}>{pct(category.total_return)}</span> · volatility {pct(category.annual_volatility)} · contributed{" "}
          <span className={signColor(category.contribution)}>{pct(category.contribution)}</span> of the portfolio&apos;s{" "}
          {pct(a.portfolio.total_return)}
        </p>
      )}
    </>
  );
}

function ContributionChart({ a }: { a: Analytics }) {
  return (
    <>
      <div className="h-72">
        <ResponsiveContainer>
          <LineChart data={a.category_contribution} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} minTickGap={50} />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={(v) => pct(v as number, 0)} domain={["auto", "auto"]} width={45} />
            <Tooltip {...tooltipStyle} itemSorter={(item) => -(item.value as number)} formatter={(v) => pct(v as number)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="portfolio" name="Portfolio" stroke="#e2e8f0" dot={false} strokeWidth={2} strokeDasharray="4 3" />
            {a.categories.map((c, i) => (
              <Line key={c.key} type="monotone" dataKey={c.key} name={c.name} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={1.5} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="tabular mt-3 w-full text-sm">
        <thead>
          <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
            <th className="pb-2 text-left font-medium">Category</th>
            <th className="pb-2 font-medium"><Term term="weight">Weight</Term></th>
            <th className="pb-2 font-medium">Return</th>
            <th className="pb-2 font-medium">Contribution</th>
            <th className="pb-2 font-medium">Share of return</th>
          </tr>
        </thead>
        <tbody>
          {a.categories.map((c, i) => (
            <tr key={c.key} className="border-t border-slate-800 text-right">
              <td className="py-1.5 text-left">
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="text-slate-200">{c.name}</span>
              </td>
              <td>{pct(c.weight, 1)}</td>
              <td className={signColor(c.total_return)}>{pct(c.total_return)}</td>
              <td className={signColor(c.contribution)}>{pct(c.contribution)}</td>
              <td className="text-slate-400">{a.portfolio.total_return && c.contribution != null ? pct(c.contribution / a.portfolio.total_return, 0) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Each category&apos;s share of the portfolio&apos;s cumulative return; the lines add up to the portfolio&apos;s. Return is the category on its own, with its holdings at their weights within it.
      </p>
    </>
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
              <th className="pb-2 font-medium"><Term term="weight">Weight</Term></th>
              <th className="pb-2 font-medium"><Term term="annualReturn">Annual return</Term></th>
              <th className="pb-2 font-medium"><Term term="volatility">Volatility</Term></th>
              <th className="pb-2 font-medium"><Term term="sharpe">Sharpe</Term></th>
              <th className="pb-2 font-medium"><Term term="maxDrawdown">Max DD</Term></th>
              <th className="pb-2 font-medium"><Term term="riskContribution">Risk contrib.</Term></th>
            </tr>
          </thead>
          <tbody>
            {a.benchmark && (
              <tr className="border-t border-slate-800 text-right text-slate-500">
                <td className="py-2 text-left font-mono">{a.benchmark.ticker} <span className="font-sans text-xs">(benchmark)</span></td>
                <td>—</td>
                <td>{pct(a.benchmark.annual_return)}</td>
                <td>{pct(a.benchmark.annual_volatility)}</td>
                <td>{num(a.benchmark.sharpe_ratio)}</td>
                <td>{pct(a.benchmark.max_drawdown)}</td>
                <td>—</td>
              </tr>
            )}
            {a.assets.map((s) => (
              <tr key={s.ticker} className="border-t border-slate-800 text-right">
                <td className="py-2 text-left font-mono">
                  <Link href={`/stocks?ticker=${encodeURIComponent(s.ticker)}`} className="text-white hover:text-sky-300">
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
