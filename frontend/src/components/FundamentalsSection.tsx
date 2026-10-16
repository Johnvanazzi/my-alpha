"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import useSWR from "swr";
import { tooltipStyle } from "./AnalyticsView";
import { InfoTip, Term } from "./InfoTip";
import { ScoreCard } from "./ScoreCard";
import { Card, Empty, ErrorBox, Segmented, Spinner, Stat } from "./ui";
import { fetcher, paths } from "@/lib/api";
import { compact, compactMoney, money, num, pct, signColor } from "@/lib/format";
import { FACTOR_TERM, METRIC_TERM } from "@/lib/glossary";
import type { FundamentalPeriod, Fundamentals, FundamentalScores, MetricDef } from "@/lib/types";

type Frequency = "annual" | "quarterly";

const axisTick = { fill: "#64748b", fontSize: 11 };

function periodLabel(date: string, frequency: Frequency) {
  const d = new Date(date + "T00:00:00");
  if (frequency === "annual") return `FY${d.getFullYear()}`;
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

function formatMetric(v: number | null | undefined, m: MetricDef, currency: string | null) {
  if (m.kind === "percent") return pct(v, 1);
  if (m.kind === "per_share") return money(v, currency);
  return compactMoney(v, currency);
}

export function FundamentalsSection({ ticker }: { ticker: string }) {
  const [frequency, setFrequency] = useState<Frequency>("annual");
  const { data, error, isLoading } = useSWR<Fundamentals>(paths.fundamentals(ticker, frequency), fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  const score = useSWR<FundamentalScores>(paths.fundamentalScore(ticker), fetcher, { revalidateOnFocus: false });

  const rows: FundamentalPeriod[] = data?.periods.map((p) => ({ ...p, label: periodLabel(p.period, data.frequency) })) ?? [];
  const cur = data?.currency ?? null;
  const ttm = data?.ttm;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <ErrorBox error={error} />
          {isLoading && !data && <Spinner label="Loading financial statements…" />}

          {ttm && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat term="epsTtm" label="EPS (TTM)" value={money(ttm.eps, cur)} hint={`Forward ${money(ttm.forward_eps, cur)}`} />
              <Stat term="revenue" label="Revenue (TTM)" value={compactMoney(ttm.revenue, cur)} hint={<span className={signColor(ttm.revenue_growth)}>{pct(ttm.revenue_growth, 1)} YoY</span>} />
              <Stat term="grossProfit" label="Gross profit (TTM)" value={compactMoney(ttm.gross_profit, cur)} />
              <Stat term="ebitda" label="EBITDA (TTM)" value={compactMoney(ttm.ebitda, cur)} />
              <Stat term="grossMargin" label="Gross margin" value={pct(ttm.gross_margin, 1)} />
              <Stat term="ebitdaMargin" label="EBITDA margin" value={pct(ttm.ebitda_margin, 1)} />
              <Stat term="netMargin" label="Net margin" value={pct(ttm.profit_margin, 1)} />
              <Stat term="pe" label="P/E" value={num(ttm.trailing_pe, 1)} hint={`Forward ${num(ttm.forward_pe, 1)}`} />
            </div>
          )}

          {data && (
            <>
              <div className="flex items-center justify-between">
                <Segmented
                  options={[
                    { value: "annual", label: "Annual" },
                    { value: "quarterly", label: "Quarterly" },
                  ]}
                  value={frequency}
                  onChange={setFrequency}
                />
                <span className="inline-flex items-center text-xs text-slate-500">
                  Values in {cur ?? "reporting currency"}
                  <InfoTip term="ttm" />
                </span>
              </div>

              {rows.length === 0 ? (
                <Empty>Yahoo Finance has no income statement data for {ticker}.</Empty>
              ) : (
                <>
                  <div className="grid gap-6 lg:grid-cols-2">
                    <Card title={<>Revenue, gross profit &amp; EBITDA<InfoTip term="ebitda" /></>}>
                      <div className="h-72">
                        <ResponsiveContainer>
                          <BarChart data={rows} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid stroke="#1e293b" vertical={false} />
                            <XAxis dataKey="label" tick={axisTick} />
                            <YAxis tick={axisTick} tickFormatter={(v) => compact(v, 1)} width={55} />
                            <Tooltip {...tooltipStyle} cursor={{ fill: "#1e293b" }} formatter={(v) => compactMoney(v as number, cur)} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="revenue" name="Revenue" fill="#60a5fa" radius={[3, 3, 0, 0]} />
                            <Bar dataKey="gross_profit" name="Gross profit" fill="#34d399" radius={[3, 3, 0, 0]} />
                            <Bar dataKey="ebitda" name="EBITDA" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>

                    <Card title={<>Earnings per share<InfoTip term="epsDiluted" /></>}>
                      <div className="h-72">
                        <ResponsiveContainer>
                          <BarChart data={rows} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid stroke="#1e293b" vertical={false} />
                            <XAxis dataKey="label" tick={axisTick} />
                            <YAxis tick={axisTick} width={45} />
                            <ReferenceLine y={0} stroke="#334155" />
                            <Tooltip {...tooltipStyle} cursor={{ fill: "#1e293b" }} formatter={(v) => money(v as number, cur)} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="eps_basic" name="Basic EPS" fill="#a78bfa" radius={[3, 3, 0, 0]} />
                            <Bar dataKey="eps_diluted" name="Diluted EPS" fill="#f472b6" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>
                  </div>

                  <Card title={<>Margins<InfoTip term="grossMargin" /></>}>
                    <div className="h-64">
                      <ResponsiveContainer>
                        <LineChart data={rows} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                          <CartesianGrid stroke="#1e293b" vertical={false} />
                          <XAxis dataKey="label" tick={axisTick} />
                          <YAxis tick={axisTick} tickFormatter={(v) => pct(v, 0)} width={45} />
                          <Tooltip {...tooltipStyle} formatter={(v) => pct(v as number, 1)} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <Line dataKey="gross_margin" name="Gross" stroke="#34d399" strokeWidth={2} />
                          <Line dataKey="ebitda_margin" name="EBITDA" stroke="#f59e0b" strokeWidth={2} />
                          <Line dataKey="net_margin" name="Net" stroke="#60a5fa" strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>

                  <Card title="Income statement summary">
                    <div className="overflow-x-auto">
                      <table className="tabular w-full text-sm">
                        <thead>
                          <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
                            <th className="pb-2 text-left font-medium">Metric</th>
                            {rows.map((r) => (
                              <th key={r.period} className="pb-2 font-medium" title={`Period ending ${r.period}`}>
                                {r.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.metrics.map((m) => (
                            <tr key={m.key} className="border-t border-slate-800 text-right">
                              <td className="py-2 text-left text-slate-300">
                                <Term term={METRIC_TERM[m.key]}>{m.label}</Term>
                                {m.key.endsWith("_growth") && <span className="ml-1 text-xs text-slate-500">vs prior period</span>}
                              </td>
                              {rows.map((r) => (
                                <td key={r.period} className={m.key.endsWith("_growth") ? signColor(r[m.key] as number | null) : ""}>
                                  {formatMetric(r[m.key] as number | null, m, cur)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </>
              )}

              {data.profile.summary && (
                <Card title="Business summary">
                  <p className="text-sm leading-relaxed text-slate-400">{data.profile.summary}</p>
                </Card>
              )}
            </>
          )}
        </div>
        <div className="flex flex-col gap-6 xl:sticky xl:top-28">
          <ErrorBox error={score.error} />
          {score.isLoading && !score.data && <Spinner label="Scoring fundamentals…" />}
          {score.data && (
            <ScoreCard
              scores={score.data}
              title="Fundamental score"
              term="fundamentalScore"
              itemTerms={FACTOR_TERM}
              scale={["Weak", "Neutral", "Strong"]}
              asOf={score.data.fiscal_year_end ? `TTM · FY ${score.data.fiscal_year_end}` : "TTM"}
              groups={score.data.groups}
              emptyText="No factors could be scored."
            />
          )}
        </div>
    </div>
  );
}
