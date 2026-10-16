"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import useSWR from "swr";
import { fetcher, paths } from "@/lib/api";
import { money, num, pct, signColor } from "@/lib/format";
import type { ArimaResult, GarchDist, GarchResult, ModelParam } from "@/lib/types";
import { tooltipStyle } from "./AnalyticsView";
import { InfoTip, Term } from "./InfoTip";
import { Button, Card, cx, ErrorBox, Field, Select, Segmented, Spinner, Stat } from "./ui";

const MAX_HORIZON = 20;
const axisTick = { fill: "#64748b", fontSize: 11 };
const PERIODS = [
  { value: "1y", label: "1Y" },
  { value: "2y", label: "2Y" },
  { value: "5y", label: "5Y" },
];
const DISTS: { value: GarchDist; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "t", label: "Student t" },
  { value: "skewt", label: "Skewed t" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function ParamsTable({ params }: { params: ModelParam[] }) {
  return (
    <table className="tabular w-full text-xs">
      <thead>
        <tr className="text-right uppercase tracking-wide text-slate-500">
          <th className="pb-1 text-left font-medium">
            <Term term="coefficients">Parameter</Term>
          </th>
          <th className="pb-1 font-medium">Value</th>
          <th className="pb-1 font-medium">p-value</th>
        </tr>
      </thead>
      <tbody>
        {params.map((p) => (
          <tr key={p.name} className="border-t border-slate-800 text-right">
            <td className="py-1 text-left font-mono text-slate-300">{p.name}</td>
            <td>{num(p.value, 4)}</td>
            <td className={p.p_value != null && p.p_value < 0.05 ? "text-emerald-400" : "text-slate-500"}>{num(p.p_value, 3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ArimaChart({ data }: { data: ArimaResult }) {
  // Join history and forecast; the last close anchors the forecast so the lines connect.
  const rows = useMemo(() => {
    const history = data.history.map((h) => ({ date: h.date, close: h.close }) as Record<string, unknown>);
    const last = history.at(-1);
    if (last) Object.assign(last, { mean: data.last_price, band80: [data.last_price, data.last_price], band95: [data.last_price, data.last_price] });
    return [
      ...history,
      ...data.forecast.map((f) => ({ date: f.date, mean: f.mean, band80: [f.lower80, f.upper80], band95: [f.lower95, f.upper95] })),
    ];
  }, [data]);

  return (
    <div className="h-80">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
          <YAxis tick={axisTick} width={55} domain={["auto", "auto"]} tickFormatter={(v) => num(v, v >= 1000 ? 0 : 2)} />
          <Tooltip
            {...tooltipStyle}
            formatter={(v, name) => (Array.isArray(v) ? [`${num(v[0] as number)} – ${num(v[1] as number)}`, name] : [num(v as number), name])}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine x={data.as_of} stroke="#475569" strokeDasharray="3 3" />
          <Area dataKey="band95" name="95% band" stroke="none" fill="#38bdf8" fillOpacity={0.12} isAnimationActive={false} />
          <Area dataKey="band80" name="80% band" stroke="none" fill="#38bdf8" fillOpacity={0.22} isAnimationActive={false} />
          <Line dataKey="close" name="Close" stroke="#e2e8f0" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          <Line dataKey="mean" name="Forecast" stroke="#38bdf8" strokeDasharray="5 3" dot={false} strokeWidth={2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Backtest({ b }: { b: NonNullable<ArimaResult["backtest"]> }) {
  const edge = b.arima.mape != null && b.naive.mape ? 1 - b.arima.mape / b.naive.mape : null;
  return (
    <Card term="backtest" title={`Backtest · ${b.horizon}-day forecasts from ${b.origins} past dates`}>
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
            <th className="pb-2 text-left font-medium">Model</th>
            <th className="pb-2 font-medium">
              <Term term="mape">MAPE</Term>
            </th>
            <th className="pb-2 font-medium">
              <Term term="rmse">RMSE</Term>
            </th>
            <th className="pb-2 font-medium">
              <Term term="hitRate">Direction</Term>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-slate-800 text-right">
            <td className="py-2 text-left text-slate-200">ARIMA</td>
            <td>{pct(b.arima.mape)}</td>
            <td>{num(b.arima.rmse)}</td>
            <td>{pct(b.arima.hit_rate, 0)}</td>
          </tr>
          <tr className="border-t border-slate-800 text-right text-slate-400">
            <td className="py-2 text-left">Random walk (no change)</td>
            <td>{pct(b.naive.mape)}</td>
            <td>{num(b.naive.rmse)}</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
      {edge != null && (
        <p className={cx("mt-3 text-xs", edge > 0.02 ? "text-emerald-400" : edge < -0.02 ? "text-rose-400" : "text-amber-300")}>
          {edge > 0.02
            ? `ARIMA's error was ${pct(edge, 0)} lower than the random walk's.`
            : edge < -0.02
              ? `ARIMA's error was ${pct(-edge, 0)} higher than the random walk's: no forecasting edge here.`
              : "ARIMA performed about the same as the random walk: little forecasting edge."}{" "}
          Based on only {b.origins} forecasts, so treat it as indicative.
        </p>
      )}
    </Card>
  );
}

function ArimaPanel({ ticker, horizon, period }: { ticker: string; horizon: number; period: string }) {
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState<[number, number, number]>([1, 0, 1]);
  const [order, setOrder] = useState<string | null>(null);
  const { data, error, isLoading, isValidating } = useSWR<ArimaResult>(paths.arima(ticker, horizon, period, order), fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  return (
    <>
      <ArimaCard
        data={data}
        error={error}
        loading={isLoading && !data}
        validating={isValidating}
        horizon={horizon}
        manual={manual}
        setManual={setManual}
        draft={draft}
        setDraft={setDraft}
        order={order}
        setOrder={setOrder}
      />
      {data?.backtest && <Backtest b={data.backtest} />}
    </>
  );
}

interface ArimaCardProps {
  data: ArimaResult | undefined;
  error: unknown;
  loading: boolean;
  validating: boolean;
  horizon: number;
  manual: boolean;
  setManual: (v: boolean) => void;
  draft: [number, number, number];
  setDraft: React.Dispatch<React.SetStateAction<[number, number, number]>>;
  order: string | null;
  setOrder: (v: string | null) => void;
}

function ArimaCard({ data, error, loading, validating: isValidating, horizon, manual, setManual, draft, setDraft, order, setOrder }: ArimaCardProps) {
  const end = data?.forecast.at(-1);

  return (
    <Card
      term="arima"
      title={`ARIMA forecast (returns → price) · ${horizon} trading day${horizon > 1 ? "s" : ""}`}
      className="min-w-0"
      actions={
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <Term term="arimaOrder">Order</Term>
          <Segmented
            options={[
              { value: "auto", label: "Auto" },
              { value: "manual", label: "Manual" },
            ]}
            value={manual ? "manual" : "auto"}
            onChange={(v) => {
              setManual(v === "manual");
              if (v === "auto") setOrder(null);
            }}
          />
          {manual && (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                setOrder(draft.join(","));
              }}
            >
              {(["p", "d", "q"] as const).map((label, i) => (
                <label key={label} className="flex items-center gap-0.5">
                  {label}
                  <input
                    type="number"
                    min={0}
                    max={label === "d" ? 1 : 5}
                    value={draft[i]}
                    onChange={(e) => setDraft((d) => d.map((v, j) => (j === i ? Math.max(0, Math.round(Number(e.target.value) || 0)) : v)) as [number, number, number])}
                    className="tabular w-10 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-right text-slate-100"
                  />
                </label>
              ))}
              <Button size="sm" variant="primary">
                Fit
              </Button>
            </form>
          )}
        </div>
      }
    >
      <ErrorBox error={error} />
      {loading && <Spinner label={order ? "Fitting ARIMA…" : "Selecting the ARIMA order among 9 models (about 10 s)…"} />}
      {data && (
        <div className={cx("flex flex-col gap-4 transition", isValidating && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <Stat term="arimaOrder" label="Order" value={`(${data.order.join(", ")})`} hint={data.auto ? "auto-selected" : "manual"} />
            <Stat term="expectedReturn" label="Expected move" value={pct(data.expected_return)} className={signColor(data.expected_return)} hint={`to ${end?.date}`} />
            <Stat term="forecastBands" label="Forecast price" value={money(end?.mean)} hint={`95%: ${num(end?.lower95)} – ${num(end?.upper95)}`} />
            <Stat term="aic" label="AIC" value={num(data.aic, 1)} hint={`BIC ${num(data.bic, 1)}`} />
            <Stat
              term="ljungBox"
              label="Ljung-Box p"
              value={num(data.ljung_box_p_value, 3)}
              className={data.ljung_box_p_value != null && data.ljung_box_p_value >= 0.05 ? "text-emerald-400" : "text-amber-300"}
              hint={data.ljung_box_p_value != null && data.ljung_box_p_value >= 0.05 ? "residuals look like noise" : "structure left in residuals"}
            />
            <Stat term="adf" label="ADF p (returns)" value={num(data.adf.returns_p_value, 3)} hint={`log price: ${num(data.adf.price_p_value, 3)} → d=${data.adf.d} on returns`} />
          </div>
          <ArimaChart data={data} />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="overflow-x-auto lg:col-span-1">
              <table className="tabular w-full text-xs">
                <thead>
                  <tr className="text-right uppercase tracking-wide text-slate-500">
                    <th className="pb-1 text-left font-medium">Date</th>
                    <th className="pb-1 font-medium">Return</th>
                    <th className="pb-1 font-medium">Forecast</th>
                    <th className="pb-1 font-medium">80%</th>
                    <th className="pb-1 font-medium">95%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecast.map((f) => (
                    <tr key={f.date} className="border-t border-slate-800 text-right">
                      <td className="py-1 text-left text-slate-400">{f.date}</td>
                      <td className={signColor(f.cumulative_return)} title={`Day: ${pct(f.daily_return, 2)}`}>
                        {pct(f.cumulative_return, 2)}
                      </td>
                      <td className="text-slate-100">{num(f.mean)}</td>
                      <td>
                        {num(f.lower80)} – {num(f.upper80)}
                      </td>
                      <td className="text-slate-400">
                        {num(f.lower95)} – {num(f.upper95)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <ParamsTable params={data.params} />
            </div>
            {data.auto && data.candidates.length > 0 && (
              <div>
                <table className="tabular w-full text-xs">
                  <thead>
                    <tr className="text-right uppercase tracking-wide text-slate-500">
                      <th className="pb-1 text-left font-medium">Candidate</th>
                      <th className="pb-1 font-medium">
                        <Term term="aic">AIC</Term>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.candidates.map((c, i) => (
                      <tr key={c.order.join()} className={cx("border-t border-slate-800 text-right", i === 0 && "text-emerald-400")}>
                        <td className="py-1 text-left font-mono">({c.order.join(", ")})</td>
                        <td>{num(c.aic, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function GarchPanel({ ticker, horizon, period }: { ticker: string; horizon: number; period: string }) {
  const [dist, setDist] = useState<GarchDist>("t");
  const { data, error, isLoading, isValidating } = useSWR<GarchResult>(paths.garch(ticker, horizon, period, dist), fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const history = data.conditional_vol.map((c) => ({ date: c.date, vol: c.vol }) as Record<string, unknown>);
    const last = history.at(-1);
    if (last) last.forecast = last.vol;
    return [...history, ...data.forecast.map((f) => ({ date: f.date, forecast: f.vol_annual }))];
  }, [data]);

  return (
    <Card
      term="garch"
      title="GARCH(1,1) volatility"
      className="min-w-0"
      actions={
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Term term="garchDist">Distribution</Term>
          <Segmented options={DISTS} value={dist} onChange={setDist} />
        </div>
      }
    >
      <ErrorBox error={error} />
      {isLoading && !data && <Spinner label="Fitting GARCH…" />}
      {data && (
        <div className={cx("flex flex-col gap-4 transition", isValidating && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <Stat term="conditionalVol" label="Current vol" value={pct(data.current_vol_annual, 1)} hint={`in ${horizon}d: ${pct(data.forecast.at(-1)?.vol_annual, 1)}`} />
            <Stat term="longRunVol" label="Long-run vol" value={pct(data.unconditional_vol_annual, 1)} />
            <Stat term="realizedVol" label="Realised vol (1M)" value={pct(data.realized_vol_annual, 1)} />
            <Stat term="persistence" label="Persistence" value={num(data.persistence, 3)} />
            <Stat term="halfLife" label="Half-life" value={data.half_life_days != null ? `${num(data.half_life_days, 1)} d` : "—"} />
            <Stat term="var95" label="1-day VaR 95%" value={pct(data.var95_1d)} className="text-rose-400" />
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={rows} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
                <YAxis tick={axisTick} width={45} tickFormatter={(v) => pct(v, 0)} domain={[0, "auto"]} />
                <Tooltip {...tooltipStyle} formatter={(v) => pct(v as number, 1)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {data.unconditional_vol_annual != null && (
                  <ReferenceLine y={data.unconditional_vol_annual} stroke="#64748b" strokeDasharray="4 3" label={{ value: "long-run", fill: "#64748b", fontSize: 10, position: "insideTopLeft" }} />
                )}
                <ReferenceLine x={data.as_of} stroke="#475569" strokeDasharray="3 3" />
                <Line dataKey="vol" name="Conditional vol (annualised)" stroke="#f59e0b" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                <Line dataKey="forecast" name="Forecast" stroke="#f59e0b" strokeDasharray="5 3" dot={false} strokeWidth={2} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <ParamsTable params={data.params} />
        </div>
      )}
    </Card>
  );
}

export function ForecastSection({ ticker }: { ticker: string }) {
  const [horizon, setHorizon] = useState(10);
  const [period, setPeriod] = useState("2y");
  const debouncedHorizon = useDebounced(horizon, 400);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-6">
        <Field label={`Horizon: ${horizon} trading day${horizon > 1 ? "s" : ""}`} className="w-64">
          <input
            type="range"
            min={1}
            max={MAX_HORIZON}
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="accent-sky-500"
            aria-label="Forecast horizon in trading days"
          />
        </Field>
        <Field label="History used to fit">
          <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <p className="flex max-w-xl items-center text-xs text-slate-500">
          Statistical extrapolations, not investment advice. Check the backtest before trusting a forecast.
          <InfoTip term="backtest" />
        </p>
      </div>
      <ArimaPanel ticker={ticker} horizon={debouncedHorizon} period={period} />
      <GarchPanel ticker={ticker} horizon={debouncedHorizon} period={period} />
    </div>
  );
}
