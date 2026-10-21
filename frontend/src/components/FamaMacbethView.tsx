"use client";

import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { paths } from "@/lib/api";
import { num, pct, signColor } from "@/lib/format";
import { useOnDemand } from "@/lib/onDemand";
import type { FamaMacbeth, FmFactor, FmPremium } from "@/lib/types";
import { tooltipStyle } from "./AnalyticsView";
import { InfoTip, Term } from "./InfoTip";
import { Card, cx, ErrorBox, RunButton, RunPrompt, Segmented, Spinner, Stat } from "./ui";

const FACTORS: { value: FmFactor; label: string }[] = [
  { value: "beta", label: "Market beta" },
  { value: "momentum", label: "Momentum" },
  { value: "volatility", label: "Volatility" },
];
const LABEL: Record<FmPremium["name"], string> = { intercept: "Intercept", beta: "Market beta", momentum: "Momentum", volatility: "Volatility" };
const COLOR: Record<FmPremium["name"], string> = { intercept: "#94a3b8", beta: "#38bdf8", momentum: "#a78bfa", volatility: "#f59e0b" };
const WINDOWS = [
  { value: "21", label: "1M" },
  { value: "63", label: "3M" },
  { value: "126", label: "6M" },
];
const axisTick = { fill: "#64748b", fontSize: 11 };

const significant = (p: number | null) => p != null && p < 0.05;
const exposure = (factor: FmFactor, v: number | null | undefined) => (factor === "beta" ? num(v) : pct(v, 1));

function PremiaTable({ premia }: { premia: FmPremium[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
            <th className="pb-2 text-left font-medium">Factor</th>
            <th className="pb-2 font-medium">
              <Term term="fmPremium">Premium / yr</Term>
            </th>
            <th className="pb-2 font-medium">
              <Term term="fmTStat">t-stat</Term>
            </th>
            <th className="pb-2 font-medium">
              <Term term="fmTStat">Newey-West t</Term>
            </th>
            <th className="pb-2 font-medium">p (NW)</th>
            <th className="pb-2 font-medium">Days positive</th>
          </tr>
        </thead>
        <tbody>
          {premia.map((p) => (
            <tr key={p.name} className="border-t border-slate-800 text-right">
              <td className="py-2 text-left text-slate-200">
                <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ background: COLOR[p.name] }} />
                {LABEL[p.name]}
              </td>
              <td className={signColor(p.annualized)}>{pct(p.annualized)}</td>
              <td className="text-slate-400">{num(p.t_stat)}</td>
              <td className={significant(p.p_value_nw) ? "font-semibold text-emerald-400" : ""}>{num(p.t_stat_nw)}</td>
              <td className={significant(p.p_value_nw) ? "text-emerald-400" : "text-slate-500"}>{num(p.p_value_nw, 3)}</td>
              <td className="text-slate-400">{pct(p.positive_share, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CumulativeChart({ data }: { data: FamaMacbeth }) {
  const names = data.premia.map((p) => p.name);
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart data={data.cumulative} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
          <YAxis tick={axisTick} width={45} tickFormatter={(v) => pct(v, 0)} />
          <Tooltip {...tooltipStyle} formatter={(v) => pct(v as number, 1)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={0} stroke="#334155" />
          {names.map((n) => (
            <Line
              key={n}
              dataKey={n}
              name={LABEL[n]}
              stroke={COLOR[n]}
              strokeDasharray={n === "intercept" ? "4 3" : undefined}
              dot={false}
              strokeWidth={n === "intercept" ? 1.5 : 2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function AssetsTable({ data }: { data: FamaMacbeth }) {
  const rows = [...data.assets.map((a) => ({ ...a, key: a.ticker, label: a.ticker })), { ...data.portfolio, key: "", label: "Portfolio", weight: 1 }];
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
            <th className="pb-2 text-left font-medium">Holding</th>
            <th className="pb-2 font-medium">Weight</th>
            {data.factors.map((f) => (
              <th key={f} className="pb-2 font-medium">
                <Term term="fmExposures">{LABEL[f]}</Term>
              </th>
            ))}
            <th className="pb-2 font-medium">Excess return / yr</th>
            <th className="pb-2 font-medium">Explained</th>
            <th className="pb-2 font-medium">
              <Term term="fmAlpha">Alpha</Term>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cx("border-t text-right", r.key ? "border-slate-800" : "border-slate-600 font-semibold")}>
              <td className={cx("py-2 text-left", r.key ? "font-mono text-slate-200" : "text-white")}>{r.label}</td>
              <td className="text-slate-400">{pct(r.weight, 1)}</td>
              {data.factors.map((f) => (
                <td key={f}>{exposure(f, r.exposures[f])}</td>
              ))}
              <td className={signColor(r.excess_return)}>{pct(r.excess_return)}</td>
              <td className="text-slate-400">{pct(r.fitted_return)}</td>
              <td className={signColor(r.alpha)}>{pct(r.alpha)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FamaMacbethPanel({ portfolioId, holdings, period, rf, benchmark }: { portfolioId: number | string; holdings: number; period: string; rf: number | null; benchmark: string }) {
  const [factors, setFactors] = useState<FmFactor[]>(["beta"]);
  const [lookback, setLookback] = useState("63");
  const maxFactors = Math.max(holdings - 2, 0);
  const toggle = (f: FmFactor) => setFactors((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : FACTORS.map((o) => o.value).filter((x) => x === f || cur.includes(x))));
  const tooMany = factors.length > maxFactors;
  const key = factors.length && !tooMany ? paths.famaMacbeth(portfolioId, period, factors, Number(lookback), rf, benchmark) : null;
  const { data, error, isLoading, isValidating, run, ran, stale } = useOnDemand<FamaMacbeth>(key);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center text-sm text-slate-400">
          Which exposures were rewarded across your holdings (Fama-MacBeth)
          <InfoTip term="famaMacbeth" />
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-1.5" role="group" aria-label="Factors">
            {FACTORS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={factors.includes(f.value)}
                onClick={() => toggle(f.value)}
                className={cx(
                  "rounded-md border px-2.5 py-1 font-medium transition",
                  factors.includes(f.value) ? "border-sky-500 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-400 hover:text-slate-200",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Term term="rollingWindow">Window</Term>
          <Segmented options={WINDOWS} value={lookback} onChange={setLookback} />
          <RunButton ran={ran} stale={stale} busy={isValidating} onRun={() => run()} />
        </div>
      </div>
      {!factors.length && <p className="text-xs text-amber-400">Choose at least one factor.</p>}
      {tooMany && (
        <p className="text-xs text-amber-400">
          With {holdings} holdings at most {maxFactors} factor{maxFactors === 1 ? "" : "s"} can be estimated (each day&apos;s regression needs more holdings than coefficients).
        </p>
      )}
      <ErrorBox error={error} />
      {!ran && key && (
        <RunPrompt onRun={() => run()}>
          Runs one cross-sectional regression per trading day over the selected period, after a {WINDOWS.find((w) => w.value === lookback)?.label} window to measure the exposures.
        </RunPrompt>
      )}
      {isLoading && !data && <Spinner label="Running daily cross-sectional regressions…" />}
      {data && (
        <div className={cx("flex flex-col gap-6 transition", (isValidating || stale) && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Regressions" value={data.periods} hint={`${data.start} → ${data.end}`} />
            <Stat label="Holdings" value={data.holdings} hint={data.benchmark ? `market: ${data.benchmark}` : undefined} />
            <Stat term="fmR2" label="Average R²" value={pct(data.avg_r2, 0)} />
            <Stat term="fmAlpha" label="Portfolio alpha / yr" value={pct(data.portfolio.alpha)} className={signColor(data.portfolio.alpha)} />
          </div>
          <Card term="fmPremium" title="Risk premia">
            <PremiaTable premia={data.premia} />
            <p className="mt-3 text-xs text-slate-500">
              Green: significant at 5% with Newey-West errors ({data.premia[0]?.nw_lags} lags). Momentum and volatility are z-scored across the holdings each day.
            </p>
          </Card>
          <Card title="Cumulative daily premia">
            <CumulativeChart data={data} />
            <p className="mt-2 text-xs text-slate-500">Running sum of each day&apos;s slope: a steady climb means the exposure paid consistently, a flat or jagged line that it didn&apos;t.</p>
          </Card>
          <Card term="fmExposures" title={`Exposures (as of ${data.exposures_as_of}) and pricing errors`}>
            <AssetsTable data={data} />
          </Card>
        </div>
      )}
    </div>
  );
}
