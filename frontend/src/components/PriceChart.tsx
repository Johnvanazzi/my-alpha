"use client";

import { Fragment, useMemo } from "react";
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compact, num, pct, signColor } from "@/lib/format";
import { INDICATOR_TERM } from "@/lib/glossary";
import type { ChartData, IndicatorSeries } from "@/lib/types";
import { tooltipStyle } from "./AnalyticsView";
import { indicatorColor } from "./IndicatorPicker";
import { InfoTip } from "./InfoTip";

export type PriceMode = "candles" | "line";

const UP = "#10b981";
const DOWN = "#f43f5e";

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

interface CandleShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: Row;
}

/**
 * Candlestick drawn by a range bar spanning [low, high]: recharts gives us the
 * pixel box for that range, and open/close are interpolated inside it.
 */
function CandleShape({ x = 0, y = 0, width = 0, height = 0, payload }: CandleShapeProps) {
  const { open, high, low, close } = (payload ?? {}) as Record<string, number | null>;
  if (open == null || high == null || low == null || close == null) return null;
  const top = Math.min(y, y + height);
  const span = Math.abs(height);
  const toPx = (v: number) => (high === low ? top : top + ((high - v) / (high - low)) * span);
  const color = close >= open ? UP : DOWN;
  const center = x + width / 2;
  const bodyTop = toPx(Math.max(open, close));
  const bodyHeight = Math.max(1, toPx(Math.min(open, close)) - bodyTop);
  const bodyWidth = Math.max(1, width * 0.75);
  return (
    <g>
      <line x1={center} x2={center} y1={top} y2={top + span} stroke={color} strokeWidth={1} />
      <rect x={center - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} />
    </g>
  );
}

interface TooltipEntry {
  dataKey?: unknown;
  name?: string;
  value?: unknown;
  color?: string;
  payload?: Row;
}

function PriceTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload ?? {};
  const [o, h, l, c] = ["open", "high", "low", "close"].map((k) => row[k] as number | null);
  const change = o && c != null ? c / o - 1 : null;
  const overlays = payload.filter((p) => typeof p.dataKey === "string" && p.dataKey.startsWith("i"));
  return (
    <div style={tooltipStyle.contentStyle} className="px-3 py-2">
      <div className="mb-1 text-slate-400">{label}</div>
      <div className="tabular grid grid-cols-[auto_auto] gap-x-3 text-slate-200">
        <span className="text-slate-500">Open</span>
        <span className="text-right">{num(o)}</span>
        <span className="text-slate-500">High</span>
        <span className="text-right">{num(h)}</span>
        <span className="text-slate-500">Low</span>
        <span className="text-right">{num(l)}</span>
        <span className="text-slate-500">Close</span>
        <span className="text-right">
          {num(c)} <span className={signColor(change)}>({pct(change)})</span>
        </span>
        {overlays.map((p) => (
          <Fragment key={String(p.dataKey)}>
            <span style={{ color: p.color }}>{p.name}</span>
            <span className="text-right">{num(p.value as number | null)}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function PaneLabel({ ind }: { ind: IndicatorSeries }) {
  return (
    <div className="mb-1 flex items-center px-1 text-xs text-slate-400">
      {ind.label}
      <InfoTip term={INDICATOR_TERM[ind.id]} />
    </div>
  );
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
  } else if (ind.id === "obv") {
    yProps = { tickFormatter: (v: number) => compact(v, 1), domain: ["auto", "auto"] };
    body = (
      <>
        <Line dataKey={dataKey(i, "obv")} name="OBV" stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        <Line dataKey={dataKey(i, "signal")} name="Signal" stroke="#f59e0b" dot={false} strokeWidth={1.5} isAnimationActive={false} />
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
      <PaneLabel ind={ind} />
      <div className="h-36">
        <ResponsiveContainer>
          <ComposedChart data={rows} syncId={SYNC_ID} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="time" tick={showAxis ? axisTick : false} height={showAxis ? 24 : 4} minTickGap={60} />
            <YAxis tick={axisTick} width={55} {...yProps} />
            <Tooltip {...tooltipStyle} formatter={(v) => (ind.id === "volume" || ind.id === "obv" ? compact(v as number) : num(v as number))} />
            {body}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function PriceChart({ data, mode = "candles" }: { data: ChartData; mode?: PriceMode }) {
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
          <span className="text-slate-400">{mode === "candles" ? "OHLC" : "Close"}</span>
          {overlays.map(({ ind, i }) => (
            <span key={i} className="inline-flex items-center" style={{ color: indicatorColor(i) }}>
              {ind.label}
              <InfoTip term={INDICATOR_TERM[ind.id]} />
            </span>
          ))}
        </div>
        <div className="h-96">
          <ResponsiveContainer>
            <ComposedChart data={rows} syncId={SYNC_ID} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="15%">
              <defs>
                <linearGradient id="closeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={up ? UP : DOWN} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={up ? UP : DOWN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="time" tick={lower.length ? false : axisTick} height={lower.length ? 4 : 24} minTickGap={60} />
              <YAxis tick={axisTick} domain={["auto", "auto"]} width={55} tickFormatter={(v) => num(v, v >= 1000 ? 0 : 2)} />
              <Tooltip content={<PriceTooltip />} />
              {mode === "candles" ? (
                <Bar dataKey={(r: Row) => [r.low, r.high]} name="Price" shape={<CandleShape />} isAnimationActive={false} />
              ) : (
                <Area dataKey="close" name="Close" stroke={up ? UP : DOWN} fill="url(#closeFill)" strokeWidth={1.5} isAnimationActive={false} />
              )}
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
