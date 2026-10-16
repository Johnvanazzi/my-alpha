"use client";

import { Fragment, useState } from "react";
import useSWR from "swr";
import { fetcher, paths } from "@/lib/api";
import { num, pct, signColor } from "@/lib/format";
import type { HrpResult, Linkage, Stats } from "@/lib/types";
import { sharpeColor } from "./AnalyticsView";
import { InfoTip, Term } from "./InfoTip";
import { Card, ErrorBox, Segmented, Spinner } from "./ui";

const LINKAGES: { value: Linkage; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "complete", label: "Complete" },
  { value: "average", label: "Average" },
  { value: "ward", label: "Ward" },
];

const CELL = 56;
const LABEL_WIDTH = 72;
const TREE_HEIGHT = 110;

function corrColor(v: number | null) {
  if (v == null) return "transparent";
  // Red for positive, blue for negative correlation.
  const alpha = Math.min(Math.abs(v), 1) * 0.75;
  return v >= 0 ? `rgba(244, 63, 94, ${alpha})` : `rgba(56, 189, 248, ${alpha})`;
}

/** Dendrogram drawn above the matrix columns: leaf k sits over column k. */
function Dendrogram({ data }: { data: HrpResult }) {
  const n = data.correlation.tickers.length;
  const maxY = Math.max(...data.dendrogram.flatMap((l) => l.y.map((y) => y ?? 0)), 1e-9);
  const px = (x: number) => (x + 0.5) * CELL;
  const py = (y: number | null) => TREE_HEIGHT - ((y ?? 0) / maxY) * (TREE_HEIGHT - 10);

  return (
    <svg width={n * CELL} height={TREE_HEIGHT} className="block" role="img" aria-label="HRP cluster dendrogram">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={0} x2={n * CELL} y1={py(maxY * f)} y2={py(maxY * f)} stroke="#1e293b" strokeDasharray="2 4" />
      ))}
      {data.dendrogram.map((link, i) => (
        <polyline
          key={i}
          points={link.x.map((x, j) => `${px(x)},${py(link.y[j])}`).join(" ")}
          fill="none"
          stroke="#38bdf8"
          strokeWidth={1.5}
        >
          <title>Merge distance {num(Math.max(...link.y.map((y) => y ?? 0)), 3)}</title>
        </polyline>
      ))}
    </svg>
  );
}

interface Hover {
  i: number;
  j: number;
  x: number;
  y: number;
}

function ClusteredCorrelation({ data }: { data: HrpResult }) {
  const { tickers, matrix } = data.correlation;
  const [hover, setHover] = useState<Hover | null>(null);
  const weights = Object.fromEntries(data.weights.map((w) => [w.ticker, w]));

  return (
    <div className="overflow-x-auto" onMouseLeave={() => setHover(null)}>
      <div style={{ paddingLeft: LABEL_WIDTH }}>
        <Dendrogram data={data} />
      </div>
      <table className="tabular border-collapse text-xs" style={{ tableLayout: "fixed" }}>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={tickers[i]}>
              <th
                style={{ width: LABEL_WIDTH }}
                className={`pr-2 text-right font-mono font-medium ${hover?.i === i ? "text-sky-300" : "text-slate-400"}`}
              >
                {tickers[i]}
              </th>
              {row.map((v, j) => (
                <td
                  key={j}
                  style={{ width: CELL, minWidth: CELL, height: 36, background: corrColor(v) }}
                  className={`border text-center text-slate-100 ${hover?.i === i && hover?.j === j ? "border-white" : "border-slate-950"} ${
                    hover && (hover.i === i || hover.j === j) && !(hover.i === i && hover.j === j) ? "brightness-125" : ""
                  }`}
                  onMouseMove={(e) => setHover({ i, j, x: e.clientX, y: e.clientY })}
                >
                  {num(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th />
            {tickers.map((t, k) => (
              <th key={t} style={{ width: CELL }} className={`pt-1 align-top font-mono font-medium ${hover?.j === k ? "text-sky-300" : "text-slate-400"}`}>
                {/* Vertical labels so long symbols (e.g. P1DD34.SA) fit the column width. */}
                <span className="inline-block whitespace-nowrap" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                  {t}
                </span>
              </th>
            ))}
          </tr>
        </tfoot>
      </table>

      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(hover.x + 14, window.innerWidth - 230), top: hover.y + 14 }}
        >
          <div className="font-mono text-slate-100">
            {tickers[hover.i]} <span className="text-slate-500">×</span> {tickers[hover.j]}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-slate-400">Correlation</span>
            <span className="tabular text-base font-semibold" style={{ color: (matrix[hover.i][hover.j] ?? 0) >= 0 ? "#fb7185" : "#38bdf8" }}>
              {num(matrix[hover.i][hover.j])}
            </span>
          </div>
          {hover.i !== hover.j && (
            <div className="tabular mt-1 grid grid-cols-[auto_auto_auto] gap-x-3 text-slate-400">
              <span />
              <span>Current</span>
              <span>HRP</span>
              {[tickers[hover.i], tickers[hover.j]].map((t) => (
                <Fragment key={t}>
                  <span className="font-mono text-slate-300">{t}</span>
                  <span>{pct(weights[t]?.current, 1)}</span>
                  <span className="text-sky-300">{pct(weights[t]?.hrp, 1)}</span>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STAT_ROWS: { key: keyof Stats; label: string; term: Parameters<typeof Term>[0]["term"]; fmt: (v: number | null) => string; higherIsBetter: boolean }[] = [
  { key: "annual_return", label: "Annual return", term: "annualReturn", fmt: (v) => pct(v), higherIsBetter: true },
  { key: "annual_volatility", label: "Volatility", term: "volatility", fmt: (v) => pct(v), higherIsBetter: false },
  { key: "sharpe_ratio", label: "Sharpe ratio", term: "sharpe", fmt: (v) => num(v), higherIsBetter: true },
  { key: "sortino_ratio", label: "Sortino ratio", term: "sortino", fmt: (v) => num(v), higherIsBetter: true },
  { key: "max_drawdown", label: "Max drawdown", term: "maxDrawdown", fmt: (v) => pct(v), higherIsBetter: true },
];

function Comparison({ data }: { data: HrpResult }) {
  return (
    <table className="tabular w-full text-sm">
      <thead>
        <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
          <th className="pb-2 text-left font-medium">Metric</th>
          <th className="pb-2 font-medium">Current</th>
          <th className="pb-2 font-medium">HRP</th>
        </tr>
      </thead>
      <tbody>
        {STAT_ROWS.map((r) => {
          const cur = data.current[r.key];
          const hrp = data.hrp[r.key];
          const hrpWins = cur != null && hrp != null && (r.higherIsBetter ? hrp > cur : hrp < cur);
          return (
            <tr key={r.key} className="border-t border-slate-800 text-right">
              <td className="py-2 text-left text-slate-300">
                <Term term={r.term}>{r.label}</Term>
              </td>
              <td className={r.key === "sharpe_ratio" ? sharpeColor(cur) : ""}>{r.fmt(cur)}</td>
              <td className={hrpWins ? "font-semibold text-emerald-400" : ""}>{r.fmt(hrp)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function WeightBars({ data }: { data: HrpResult }) {
  const max = Math.max(...data.weights.flatMap((w) => [w.current, w.hrp ?? 0]), 1e-9);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-slate-500" /> Current
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-sky-400" /> HRP
        </span>
      </div>
      {data.weights.map((w) => {
        const delta = (w.hrp ?? 0) - w.current;
        return (
          <div key={w.ticker} className="grid grid-cols-[64px_1fr_110px] items-center gap-2 text-xs">
            <span className="font-mono text-slate-200">{w.ticker}</span>
            <div className="flex flex-col gap-0.5">
              <div className="h-2 rounded-sm bg-slate-500" style={{ width: `${(w.current / max) * 100}%` }} />
              <div className="h-2 rounded-sm bg-sky-400" style={{ width: `${((w.hrp ?? 0) / max) * 100}%` }} />
            </div>
            <span className="tabular text-right text-slate-400">
              {pct(w.current, 1)} → <span className="text-slate-100">{pct(w.hrp, 1)}</span>{" "}
              <span className={signColor(delta)}>
                ({delta >= 0 ? "+" : ""}
                {(delta * 100).toFixed(1)})
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function HrpPanel({ portfolioId, period, rf }: { portfolioId: number | string; period: string; rf: number | null }) {
  const [linkage, setLinkage] = useState<Linkage>("single");
  const { data, error, isLoading, isValidating } = useSWR<HrpResult>(paths.hrp(portfolioId, period, linkage, rf), fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center text-sm text-slate-400">
          Hierarchical Risk Parity allocation for the same holdings
          <InfoTip term="hrp" />
        </p>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Term term="linkage">Linkage</Term>
          <Segmented options={LINKAGES} value={linkage} onChange={setLinkage} />
        </div>
      </div>
      <ErrorBox error={error} />
      {isLoading && !data && <Spinner label="Clustering holdings…" />}
      {data && (
        <div className={isValidating ? "flex flex-col gap-6 opacity-60 transition" : "flex flex-col gap-6 transition"}>
          <Card term="clusteredCorrelation" title="Clustered correlation & dendrogram">
            <ClusteredCorrelation data={data} />
            <p className="mt-3 flex items-center text-xs text-slate-500">
              Tree height is the HRP distance between clusters
              <InfoTip term="dendrogram" />
            </p>
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Weights: current vs HRP">
              <WeightBars data={data} />
            </Card>
            <Card title="Backtest over the same period">
              <Comparison data={data} />
              <p className="mt-3 text-xs text-slate-500">
                In-sample: HRP weights are computed from this same period, so its edge here is optimistic. Use it to see how risk is spread, not as a
                forecast.
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
