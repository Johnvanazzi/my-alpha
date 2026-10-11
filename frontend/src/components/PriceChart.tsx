"use client";

import { Fragment, useMemo } from "react";
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compact, num } from "@/lib/format";
import type { ChartData, IndicatorSeries } from "@/lib/types";
import { tooltipStyle } from "./AnalyticsView";
import { indicatorColor } from "./IndicatorPicker";

type Row = Record<string, number | string | null>;

const SYNC_ID = "technical";
const axisTick = { fill: "#64748b", fontSize: 11 };
const dataKey = (i: number, output: string) => `i${i}_${output}`;

/** Flatten candles and every indicator output into one row per bar, as recharts expects. */
function buildRows(data: ChartData): Row[] {
  return data.candles.map((c, bar) => {
    const row: Row = { ...c };
    data.indicators.forEach((ind, i) => {
      for (const [output, values] of Object.entries(ind.series)) row[dataKey(i, output)] = values[bar];
    });
    return row;
  });
}

function PriceOverlay({ ind, i }: { ind: IndicatorSeries; i: number }) {
  const color = indicatorColor(i);
  if (ind.id === "bbands") {
    return (
      <>
        <Line dataKey={dataKey(i, "upper")} name={`${ind.label} upper`} stroke={color} strokeDasharray="4 3" dot={false} strokeWidth={1} isAnimationActive={false} />
        <Line dataKey={dataKey(i, "middle")} name={`${ind.label} mid`} stroke={color} dot={false} strokeWidth={1} strokeOpacity={0.6} isAnimationActive={false} />
        <Line dataKey={dataKey(i, "lower")} name={`${ind.label} lower`} stroke={color} strokeDasharray="4 3" dot={false} strokeWidth={1} isAnimationActive={false} />
      </>
    );
  }
  return <Line dataKey={dataKey(i, "value")} name={ind.label} stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />;
}

function LowerPane({ ind, i, rows, showAxis }: { ind: IndicatorSeries; i: number; rows: Row[]; showAxis: boolean }) {
  const color = indicatorColor(i);
  let body: React.ReactNode;
  let yProps: Record<string, unknown> = { domain: ["auto", "auto"] };

  if (ind.id === "rsi") {
    yProps = { domain: [0, 100], ticks: [30, 50, 70] };
    body = (
      <>
        <ReferenceLine y={70} stroke="#f43f5e" strokeDasharray="3 3" strokeOpacity={0.6} />
        <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.6} />
        <Line dataKey={dataKey(i, "value")} name={ind.label} stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
      </>
    );
  } else if (ind.id === "macd") {
    const histKey = dataKey(i, "histogram");
    body = (
      <>
        <ReferenceLine y={0} stroke="#334155" />
        <Bar dataKey={histKey} name="Histogram" isAnimationActive={false}>
          {rows.map((r, j) => (
            <Cell key={j} fill={(r[histKey] as number) >= 0 ? "#10b98199" : "#f43f5e99"} />
          ))}
        </Bar>
        <Line dataKey={dataKey(i, "macd")} name="MACD" stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        <Line dataKey={dataKey(i, "signal")} name="Signal" stroke="#f59e0b" dot={false} strokeWidth={1.5} isAnimationActive={false} />
      </>
    );
  } else if (ind.id === "volume") {
    yProps = { tickFormatter: (v: number) => compact(v, 1) };
    body = (
      <>
        <Bar dataKey={dataKey(i, "volume")} name="Volume" isAnimationActive={false}>
          {rows.map((r, j) => (
            <Cell key={j} fill={(r.close as number) >= (r.open as number) ? "#10b98166" : "#f43f5e66"} />
          ))}
        </Bar>
        <Line dataKey={dataKey(i, "average")} name="Average" stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
      </>
    );
  } else {
    // Generic fallback for indicators added to the backend registry later.
    body = Object.keys(ind.series).map((output, j) => (
      <Line key={output} dataKey={dataKey(i, output)} name={output} stroke={indicatorColor(i + j)} dot={false} isAnimationActive={false} />
    ));
  }

  return (
    <div>
      <div className="mb-1 px-1 text-xs text-slate-400">{ind.label}</div>
      <div className="h-36">
        <ResponsiveContainer>
          <ComposedChart data={rows} syncId={SYNC_ID} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="time" tick={showAxis ? axisTick : false} height={showAxis ? 24 : 4} minTickGap={60} />
            <YAxis tick={axisTick} width={55} {...yProps} />
            <Tooltip {...tooltipStyle} formatter={(v) => (ind.id === "volume" ? compact(v as number) : num(v as number))} />
            {body}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function PriceChart({ data }: { data: ChartData }) {
  const rows = useMemo(() => buildRows(data), [data]);
  const overlays = data.indicators.map((ind, i) => ({ ind, i })).filter((x) => x.ind.pane === "price");
  const lower = data.indicators.map((ind, i) => ({ ind, i })).filter((x) => x.ind.pane !== "price");
  const first = data.candles[0]?.close;
  const last = data.candles.at(-1)?.close;
  const up = first != null && last != null && last >= first;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs">
          <span className="text-slate-400">Close</span>
          {overlays.map(({ ind, i }) => (
            <span key={i} style={{ color: indicatorColor(i) }}>
              {ind.label}
            </span>
          ))}
        </div>
        <div className="h-96">
          <ResponsiveContainer>
            <ComposedChart data={rows} syncId={SYNC_ID} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="closeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={up ? "#10b981" : "#f43f5e"} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={up ? "#10b981" : "#f43f5e"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="time" tick={lower.length ? false : axisTick} height={lower.length ? 4 : 24} minTickGap={60} />
              <YAxis tick={axisTick} domain={["auto", "auto"]} width={55} tickFormatter={(v) => num(v, v >= 1000 ? 0 : 2)} />
              <Tooltip {...tooltipStyle} formatter={(v) => num(v as number)} />
              <Area dataKey="close" name="Close" stroke={up ? "#10b981" : "#f43f5e"} fill="url(#closeFill)" strokeWidth={1.5} isAnimationActive={false} />
              {overlays.map(({ ind, i }) => (
                <Fragment key={i}>{PriceOverlay({ ind, i })}</Fragment>
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      {lower.map(({ ind, i }, k) => (
        <LowerPane key={i} ind={ind} i={i} rows={rows} showAxis={k === lower.length - 1} />
      ))}
    </div>
  );
}
