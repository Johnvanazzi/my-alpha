"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import useSWR from "swr";
import { fetcher, paths } from "@/lib/api";
import { num, pct, signColor } from "@/lib/format";
import type { GlossaryKey } from "@/lib/glossary";
import type { Tearsheet } from "@/lib/types";
import { tooltipStyle } from "./AnalyticsView";
import { InfoTip, Term } from "./InfoTip";
import { Card, ErrorBox, Segmented, Spinner, Stat } from "./ui";

const WINDOWS = [
  { value: "21", label: "1M" },
  { value: "63", label: "3M" },
  { value: "126", label: "6M" },
  { value: "252", label: "1Y" },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const axisTick = { fill: "#64748b", fontSize: 11 };
const PORTFOLIO = "#38bdf8";
const BENCH = "#94a3b8";

function ChartCard({ title, term, children }: { title: string; term: GlossaryKey; children: React.ReactNode }) {
  return (
    <Card term={term} title={title}>
      <div className="h-56">
        <ResponsiveContainer>{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </Card>
  );
}

function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Histogram bins with a "nice" width (0.5%, 1%, 2%, 5%…) giving roughly 12 buckets. */
function histogram(values: number[]) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const raw = Math.max((max - min) / 12, 0.0025);
  const width = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2].find((w) => w >= raw) ?? 0.25;
  const start = Math.floor(min / width) * width;
  const count = Math.max(1, Math.ceil((max - start) / width + 1e-9));
  const bins = Array.from({ length: count }, (_, i) => ({ from: start + i * width, to: start + (i + 1) * width, count: 0 }));
  for (const v of values) bins[Math.min(count - 1, Math.floor((v - start) / width + 1e-9))].count++;
  return bins.map((b) => ({ ...b, label: `${(b.from * 100).toFixed(1)}%`, mid: (b.from + b.to) / 2 }));
}

export function MonthlyHeatmap({ data }: { data: Tearsheet["monthly_returns"] }) {
  const years = [...new Set(data.map((d) => d.year))].sort();
  const lookup = new Map(data.map((d) => [`${d.year}-${d.month}`, d.return]));
  const color = (v: number | null | undefined) => {
    if (v == null) return "transparent";
    const alpha = Math.min(Math.abs(v) / 0.08, 1) * 0.7;
    return v >= 0 ? `rgba(16, 185, 129, ${alpha})` : `rgba(244, 63, 94, ${alpha})`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="pb-1 text-left font-medium">Year</th>
            {MONTHS.map((m) => (
              <th key={m} className="pb-1 font-medium">
                {m}
              </th>
            ))}
            <th className="pb-1 font-medium">Year</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            const months = MONTHS.map((_, i) => lookup.get(`${y}-${i + 1}`));
            const total = months.reduce<number | null>((acc, v) => (v == null ? acc : (1 + (acc ?? 0)) * (1 + v) - 1), null);
            return (
              <tr key={y}>
                <td className="pr-2 text-slate-400">{y}</td>
                {months.map((v, i) => (
                  <td key={i} className="h-7 min-w-11 border border-slate-950 text-center text-slate-100" style={{ background: color(v) }}>
                    {v == null ? "" : (v * 100).toFixed(1)}
                  </td>
                ))}
                <td className={`pl-2 text-right font-semibold ${signColor(total)}`}>{pct(total, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TearsheetPanel({ portfolioId, period, rf, benchmark }: { portfolioId: number | string; period: string; rf: number | null; benchmark: string }) {
  const [rollingWindow, setRollingWindow] = useState("126");
  const { data, error, isLoading, isValidating } = useSWR<Tearsheet>(paths.tearsheet(portfolioId, period, Number(rollingWindow), rf, benchmark), fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  const monthly = useMemo(() => (data?.monthly_returns ?? []).map((m) => m.return).filter((v): v is number => v != null), [data]);
  const bins = useMemo(() => histogram(monthly), [monthly]);
  const sharpeMean = useMemo(() => mean((data?.rolling ?? []).map((r) => r.sharpe).filter((v): v is number => v != null)), [data]);
  const bench = data?.benchmark ?? benchmark;
  const monthlyMean = mean(monthly);
  const sorted = [...monthly].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">Rolling risk, drawdowns and monthly returns (pyfolio) vs {bench}</p>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Term term="rollingWindow">Rolling window</Term>
          <Segmented options={WINDOWS} value={rollingWindow} onChange={setRollingWindow} />
        </div>
      </div>
      <ErrorBox error={error} />
      {data?.benchmark_error && <p className="text-xs text-amber-400">{data.benchmark_error}</p>}
      {isLoading && !data && <Spinner label="Running pyfolio analysis…" />}
      {data && !error && (
        <div className={isValidating ? "flex flex-col gap-6 opacity-60 transition" : "flex flex-col gap-6 transition"}>
          <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard term="rollingVolatility" title={`Rolling volatility (${WINDOWS.find((w) => w.value === rollingWindow)?.label})`}>
              <LineChart data={data.rolling} syncId="tearsheet" margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
                <YAxis tick={axisTick} tickFormatter={(v) => pct(v, 0)} width={45} />
                <Tooltip {...tooltipStyle} formatter={(v) => pct(v as number)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="volatility" name="Portfolio" stroke={PORTFOLIO} dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line dataKey="benchmark_volatility" name={bench} stroke={BENCH} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
              </LineChart>
            </ChartCard>

            <ChartCard term="rollingBeta" title={`Rolling beta to ${bench}`}>
              <LineChart data={data.rolling} syncId="tearsheet" margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
                <YAxis tick={axisTick} width={45} domain={["auto", "auto"]} tickFormatter={(v) => num(v, 1)} />
                <Tooltip {...tooltipStyle} formatter={(v) => num(v as number)} />
                <ReferenceLine y={1} stroke="#64748b" strokeDasharray="4 3" />
                <Line dataKey="beta" name="Beta" stroke="#a78bfa" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ChartCard>

            <ChartCard term="rollingSharpe" title="Rolling Sharpe ratio">
              <LineChart data={data.rolling} syncId="tearsheet" margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
                <YAxis tick={axisTick} width={45} tickFormatter={(v) => num(v, 1)} />
                <Tooltip {...tooltipStyle} formatter={(v) => num(v as number)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#334155" />
                {sharpeMean != null && <ReferenceLine y={sharpeMean} stroke={PORTFOLIO} strokeDasharray="4 3" strokeOpacity={0.6} />}
                <Line dataKey="sharpe" name="Portfolio" stroke={PORTFOLIO} dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line dataKey="benchmark_sharpe" name={bench} stroke={BENCH} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
              </LineChart>
            </ChartCard>

            <ChartCard term="underwater" title="Underwater plot">
              <AreaChart data={data.underwater} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
                <YAxis tick={axisTick} width={45} tickFormatter={(v) => pct(v, 0)} domain={["dataMin", 0]} />
                <Tooltip {...tooltipStyle} formatter={(v) => pct(v as number)} />
                <Area dataKey="drawdown" name="Drawdown" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.3} isAnimationActive={false} />
              </AreaChart>
            </ChartCard>
          </div>

          <Card term="drawdownTable" title="Worst drawdowns">
            <div className="overflow-x-auto">
              <table className="tabular w-full text-sm">
                <thead>
                  <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 text-left font-medium">#</th>
                    <th className="pb-2 font-medium">Net drawdown</th>
                    <th className="pb-2 font-medium">Peak</th>
                    <th className="pb-2 font-medium">Valley</th>
                    <th className="pb-2 font-medium">Recovery</th>
                    <th className="pb-2 font-medium">Duration (days)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.drawdowns.map((d, i) => (
                    <tr key={i} className="border-t border-slate-800 text-right">
                      <td className="py-2 text-left text-slate-500">{i + 1}</td>
                      <td className="text-rose-400">{pct(d.net_drawdown == null ? null : -d.net_drawdown)}</td>
                      <td>{d.peak}</td>
                      <td>{d.valley}</td>
                      <td>{d.recovery ?? <span className="text-amber-400">not recovered</span>}</td>
                      <td>{d.duration_days ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[2fr_3fr]">
            <Card term="monthlyReturns" title="Distribution of monthly returns">
              <div className="mb-3 grid grid-cols-3 gap-2">
                <Stat label="Mean" value={pct(monthlyMean)} className={signColor(monthlyMean)} />
                <Stat label="Median" value={pct(median)} className={signColor(median)} />
                <Stat label="Positive" value={monthly.length ? pct(monthly.filter((v) => v > 0).length / monthly.length, 0) : "—"} hint={`${monthly.length} months`} />
              </div>
              <div className="h-48">
                <ResponsiveContainer>
                  <BarChart data={bins} margin={{ top: 5, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
                    <CartesianGrid stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                    <YAxis tick={axisTick} width={30} allowDecimals={false} />
                    <Tooltip
                      {...tooltipStyle}
                      cursor={{ fill: "#1e293b" }}
                      labelFormatter={(_, p) => {
                        const b = p?.[0]?.payload as { from: number; to: number } | undefined;
                        return b ? `${pct(b.from, 1)} to ${pct(b.to, 1)}` : "";
                      }}
                      formatter={(v) => [`${v} months`, "Count"]}
                    />
                    <Bar dataKey="count" isAnimationActive={false}>
                      {bins.map((b, i) => (
                        <Cell key={i} fill={b.mid >= 0 ? "#10b981" : "#f43f5e"} fillOpacity={0.75} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title={<>Monthly returns (%)<InfoTip term="monthlyReturns" /></>}>
              <MonthlyHeatmap data={data.monthly_returns} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
