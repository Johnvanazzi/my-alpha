"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import useSWR from "swr";
import { api, fetcher, paths } from "@/lib/api";
import { num, pct, PERIODS, signColor } from "@/lib/format";
import type { GlossaryKey } from "@/lib/glossary";
import type { BacktestCurvePoint, BacktestResult, BacktestRun, BacktestStats, BacktestTarget, StrategyMeta, StrategyParam } from "@/lib/types";
import { sharpeColor, tooltipStyle } from "./AnalyticsView";
import { BenchmarkPicker } from "./BenchmarkPicker";
import { InfoTip, Term } from "./InfoTip";
import { MonthlyHeatmap } from "./TearsheetView";
import { Button, Card, Empty, ErrorBox, Field, Input, Segmented, Select, Spinner, Stat } from "./ui";

const axisTick = { fill: "#64748b", fontSize: 11 };
const STRATEGY = "#38bdf8";
const BUY_HOLD = "#f59e0b";
const BENCH = "#94a3b8";
// Charts get slow beyond a few thousand points; long histories are thinned for display only.
const MAX_POINTS = 1500;
const BACKTEST_PERIODS = PERIODS.filter((p) => ["6mo", "ytd", "1y", "2y", "5y", "10y", "max"].includes(p.value));
const PARAM_TERMS: Record<string, GlossaryKey> = { rebalance: "rebalanceFrequency", lookback_months: "lookback" };

type ParamValues = Record<string, string>;

interface Props {
  target: BacktestTarget;
  /** Fixed benchmark (portfolio pages use the saved one); without it the panel shows its own picker. */
  benchmark?: string;
  rf?: number | null;
}

function defaults(strategy: StrategyMeta | undefined): ParamValues {
  return Object.fromEntries((strategy?.params ?? []).map((p) => [p.name, String(p.default)]));
}

function parseParams(strategy: StrategyMeta, values: ParamValues): Record<string, number | string> {
  return Object.fromEntries(strategy.params.map((p) => [p.name, p.type === "choice" ? values[p.name] : Number(values[p.name])]));
}

function thin(points: BacktestCurvePoint[]): BacktestCurvePoint[] {
  if (points.length <= MAX_POINTS) return points;
  const step = Math.ceil(points.length / MAX_POINTS);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

/** Readable ticks for a log axis (recharts only draws a few): 1-2-5 steps, or finer for narrow ranges. */
function logAxis(points: BacktestCurvePoint[]) {
  const values = points.flatMap((p) => [p.strategy, p.buy_hold, p.benchmark]).filter((v): v is number => v != null && v > 0);
  if (!values.length) return { domain: ["auto", "auto"] as [string, string], ticks: undefined };
  const lo = Math.min(...values) * 0.95;
  const hi = Math.max(...values) * 1.05;
  const candidates = (steps: number[]) => {
    const out: number[] = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of steps) out.push(m * 10 ** e);
    return out.filter((v) => v >= lo && v <= hi);
  };
  let ticks = candidates([1, 2, 5]);
  if (ticks.length < 4) ticks = candidates([1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8]);
  return { domain: [lo, hi] as [number, number], ticks };
}

function paramSummary(strategy: StrategyMeta | undefined, params: Record<string, number | string>) {
  if (!strategy?.params.length) return "";
  return strategy.params.map((p) => `${p.label.replace(/\s*\(.*\)$/, "")} ${params[p.name] ?? p.default}`).join(", ");
}

export function BacktestPanel({ target, benchmark: fixedBenchmark, rf = null }: Props) {
  const kind = target.type;
  const { data: allStrategies, error: metaError } = useSWR<StrategyMeta[]>(paths.backtestStrategies, fetcher, { revalidateOnFocus: false });
  const strategies = useMemo(() => (allStrategies ?? []).filter((s) => s.kind === kind), [allStrategies, kind]);
  const runsKey = paths.backtests(target.type === "stock" ? { ticker: target.ticker } : { portfolioId: target.portfolio_id });
  const runs = useSWR<BacktestRun[]>(runsKey, fetcher, { revalidateOnFocus: false });

  const [strategyId, setStrategyId] = useState<string>("");
  const [values, setValues] = useState<ParamValues>({});
  const [period, setPeriod] = useState("5y");
  const [ownBenchmark, setOwnBenchmark] = useState("SPY");
  const [commission, setCommission] = useState("5");
  const [slippage, setSlippage] = useState("5");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const strategy = strategies.find((s) => s.id === strategyId);
  const benchmark = fixedBenchmark ?? ownBenchmark;

  // Pick the first non-trivial strategy once metadata arrives (or the target changes kind).
  useEffect(() => {
    if (strategies.length && !strategies.some((s) => s.id === strategyId)) {
      const first = strategies.find((s) => s.params.length) ?? strategies[0];
      setStrategyId(first.id);
      setValues(defaults(first));
    }
  }, [strategies, strategyId]);

  // A result belongs to one target; clear it when the ticker or portfolio changes.
  const targetKey = target.type === "stock" ? target.ticker : String(target.portfolio_id);
  useEffect(() => setResult(null), [targetKey]);

  const chooseStrategy = (id: string) => {
    setStrategyId(id);
    setValues(defaults(strategies.find((s) => s.id === id)));
  };

  /** Run the form's settings, or a saved run's (`override`, re-run without saving it again). */
  const run = async (override?: { id: number; strategy: StrategyMeta; values: ParamValues; period: string; benchmark: string; commission: string; slippage: string }) => {
    const s = override?.strategy ?? strategy;
    if (!s) return;
    setRunning(true);
    setError(null);
    try {
      const res = await api.runBacktest({
        target,
        strategy: { id: s.id, params: parseParams(s, override?.values ?? values) },
        period: override?.period ?? period,
        benchmark: override?.benchmark ?? benchmark,
        commission_bps: Number(override?.commission ?? commission) || 0,
        slippage_bps: Number(override?.slippage ?? slippage) || 0,
        risk_free_rate: rf,
        save: !override,
      });
      setResult(override ? { ...res, id: override.id } : res);
      if (!override) runs.mutate();
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
    }
  };

  const load = (saved: BacktestRun) => {
    const s = strategies.find((x) => x.id === saved.strategy_id);
    if (!s) return;
    const loaded = {
      id: saved.id,
      strategy: s,
      values: { ...defaults(s), ...Object.fromEntries(Object.entries(saved.params).map(([k, v]) => [k, String(v)])) },
      period: saved.config.period,
      benchmark: fixedBenchmark ?? saved.config.benchmark ?? "",
      commission: String(saved.config.commission_bps),
      slippage: String(saved.config.slippage_bps),
    };
    setStrategyId(s.id);
    setValues(loaded.values);
    setPeriod(loaded.period);
    if (!fixedBenchmark && saved.config.benchmark) setOwnBenchmark(saved.config.benchmark);
    setCommission(loaded.commission);
    setSlippage(loaded.slippage);
    run(loaded);
  };

  const remove = async (id: number) => {
    await api.deleteBacktest(id);
    runs.mutate((list) => list?.filter((r) => r.id !== id), { revalidate: false });
  };

  if (metaError) return <ErrorBox error={metaError} />;
  if (!allStrategies) return <Spinner label="Loading strategies…" />;

  return (
    <div className="flex flex-col gap-6">
      <Card
        term="strategyBacktest"
        title="Strategy"
        actions={
          <span className="text-xs text-slate-500">
            <Term term="backtestExecution">How trades are executed</Term>
          </span>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Strategy" className="min-w-56">
              <Select value={strategyId} onChange={(e) => chooseStrategy(e.target.value)}>
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            {strategy?.params.map((p) => (
              <ParamInput key={p.name} param={p} value={values[p.name] ?? ""} onChange={(v) => setValues((old) => ({ ...old, [p.name]: v }))} />
            ))}
          </div>
          {strategy && <p className="text-xs text-slate-400">{strategy.description}</p>}
          <div className="flex flex-wrap items-end gap-3">
            <Group label="Period">
              <Segmented options={BACKTEST_PERIODS} value={period} onChange={setPeriod} />
            </Group>
            {!fixedBenchmark && <BenchmarkPicker value={ownBenchmark} onChange={setOwnBenchmark} />}
            <Field label="Commission (bps)" term="commission">
              <Input type="number" min={0} max={500} step="any" value={commission} onChange={(e) => setCommission(e.target.value)} className="w-28 py-1 text-right" />
            </Field>
            <Field label="Slippage (bps)" term="slippage">
              <Input type="number" min={0} max={500} step="any" value={slippage} onChange={(e) => setSlippage(e.target.value)} className="w-28 py-1 text-right" />
            </Field>
            <Button type="submit" variant="primary" disabled={running || !strategy}>
              {running ? "Running…" : "Run backtest"}
            </Button>
          </div>
        </form>
      </Card>

      <ErrorBox error={error} />
      {running && !result && <Spinner label="Downloading prices and simulating trades…" />}
      {result && (
        <div className={running ? "flex flex-col gap-6 opacity-60 transition" : "flex flex-col gap-6 transition"}>
          <BacktestResults result={result} strategyMeta={allStrategies.find((s) => s.id === result.strategy.id)} />
        </div>
      )}

      <SavedRuns runs={runs.data} error={runs.error} strategies={allStrategies} onLoad={load} onDelete={remove} activeId={result?.id ?? null} />
    </div>
  );
}

/** Like Field, but a div: a <label> would forward clicks to the first button inside. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      {children}
    </div>
  );
}

function ParamInput({ param, value, onChange }: { param: StrategyParam; value: string; onChange: (v: string) => void }) {
  const term = PARAM_TERMS[param.name];
  if (param.type === "choice") {
    return (
      <Field label={param.label} term={term}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {param.options?.map((o) => (
            <option key={o} value={o}>
              {o === o.toLowerCase() && o.length <= 3 ? o.toUpperCase() : o[0].toUpperCase() + o.slice(1)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  return (
    <Field label={param.label} term={term}>
      <Input
        type="number"
        required
        min={param.min ?? undefined}
        max={param.max ?? undefined}
        step={param.step ?? (param.type === "int" ? 1 : "any")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 py-1 text-right"
      />
    </Field>
  );
}

function compareHint(bh: BacktestStats, bench: (BacktestStats & { ticker: string }) | null, key: keyof BacktestStats, fmt: (v: number | null) => string) {
  return (
    <>
      B&amp;H {fmt(bh[key])}
      {bench && ` · ${bench.ticker} ${fmt(bench[key])}`}
    </>
  );
}

export function BacktestResults({ result, strategyMeta }: { result: BacktestResult; strategyMeta?: StrategyMeta }) {
  const { strategy: s, buy_hold: bh, benchmark: bench } = result.stats;
  const isPortfolio = result.target.type === "portfolio";
  const [scale, setScale] = useState<"linear" | "log">("linear");
  const equity = useMemo(() => thin(result.equity), [result.equity]);
  const drawdown = useMemo(() => thin(result.drawdown), [result.drawdown]);
  const log = useMemo(() => logAxis(equity), [equity]);
  const p = (v: number | null) => pct(v);
  const n = (v: number | null) => num(v);

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-white">{result.strategy.name}</h3>
        <span className="text-sm text-slate-400">{paramSummary(strategyMeta, result.strategy.params)}</span>
        <span className="text-xs text-slate-500">
          {result.start} → {result.end} · {result.observations} days · costs {num(result.config.commission_bps, 1)} + {num(result.config.slippage_bps, 1)} bps · risk-free {pct(result.risk_free_rate)}
        </span>
      </div>
      {result.benchmark_error && <p className="text-xs text-amber-400">{result.benchmark_error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total return" term="totalReturn" value={pct(s.total_return)} className={signColor(s.total_return)} hint={compareHint(bh, bench, "total_return", p)} />
        <Stat label="CAGR" term="annualReturn" value={pct(s.annual_return)} className={signColor(s.annual_return)} hint={compareHint(bh, bench, "annual_return", p)} />
        <Stat label="Volatility" term="volatility" value={pct(s.annual_volatility)} hint={compareHint(bh, bench, "annual_volatility", p)} />
        <Stat label="Sharpe" term="sharpe" value={num(s.sharpe_ratio)} className={sharpeColor(s.sharpe_ratio)} hint={compareHint(bh, bench, "sharpe_ratio", n)} />
        <Stat label="Sortino" term="sortino" value={num(s.sortino_ratio)} hint={compareHint(bh, bench, "sortino_ratio", n)} />
        <Stat label="Max drawdown" term="maxDrawdown" value={pct(s.max_drawdown)} className="text-rose-400" hint={compareHint(bh, bench, "max_drawdown", p)} />
        <Stat label={isPortfolio ? "Rebalances" : "Trades"} term="tradeCount" value={s.trades} />
        <Stat label="Win rate" term="winRate" value={pct(s.win_rate, 0)} />
        <Stat label="Exposure" term="exposure" value={pct(s.exposure, 0)} />
        <Stat label="Turnover" term="turnover" value={s.turnover == null ? "—" : `${num(s.turnover, 2)}×`} hint="per year" />
        <Stat label="Cost drag" term="tradingCosts" value={pct(s.costs)} className={s.costs ? "text-amber-300" : ""} />
        <Stat
          label="vs buy & hold"
          term="buyHold"
          value={pct(s.annual_return != null && bh.annual_return != null ? s.annual_return - bh.annual_return : null)}
          className={signColor(s.annual_return != null && bh.annual_return != null ? s.annual_return - bh.annual_return : null)}
          hint="CAGR difference"
        />
      </div>

      <Card
        term="equityCurve"
        title="Equity curve"
        actions={
          <Segmented
            options={[
              { value: "linear", label: "Linear" },
              { value: "log", label: "Log" },
            ]}
            value={scale}
            onChange={setScale}
          />
        }
      >
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={equity} syncId="backtest" margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
              {scale === "log" ? (
                <YAxis tick={axisTick} width={55} scale="log" domain={log.domain} ticks={log.ticks} allowDataOverflow tickFormatter={(v) => num(v, 0)} />
              ) : (
                <YAxis tick={axisTick} width={55} domain={["auto", "auto"]} tickFormatter={(v) => num(v, 0)} />
              )}
              <Tooltip {...tooltipStyle} formatter={(v) => num(v as number)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey={(r: BacktestCurvePoint) => r.strategy} name="Strategy" stroke={STRATEGY} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey={(r: BacktestCurvePoint) => r.buy_hold} name="Buy & hold" stroke={BUY_HOLD} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              {result.benchmark && !result.benchmark_error && (
                <Line dataKey={(r: BacktestCurvePoint) => r.benchmark} name={result.benchmark} stroke={BENCH} dot={false} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card term="underwater" title="Drawdown">
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={drawdown} syncId="backtest" margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} minTickGap={50} />
              <YAxis tick={axisTick} width={55} tickFormatter={(v) => pct(v, 0)} domain={["dataMin", 0]} />
              <Tooltip {...tooltipStyle} formatter={(v) => pct(v as number)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey={(r: BacktestCurvePoint) => r.strategy} name="Strategy" stroke={STRATEGY} dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line dataKey={(r: BacktestCurvePoint) => r.buy_hold} name="Buy & hold" stroke={BUY_HOLD} dot={false} strokeWidth={1.2} isAnimationActive={false} />
              {result.benchmark && !result.benchmark_error && (
                <Line dataKey={(r: BacktestCurvePoint) => r.benchmark} name={result.benchmark} stroke={BENCH} dot={false} strokeWidth={1.2} strokeDasharray="4 3" isAnimationActive={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {result.trades && <TradesTable trades={result.trades} />}
      {result.rebalances && <RebalanceTable rebalances={result.rebalances} tickers={result.tickers ?? []} />}

      <Card title={<>Strategy monthly returns (%)<InfoTip term="monthlyReturns" /></>}>
        <MonthlyHeatmap data={result.monthly_returns} />
      </Card>
    </>
  );
}

function TradesTable({ trades }: { trades: NonNullable<BacktestResult["trades"]> }) {
  return (
    <Card title={`Trades (${trades.length})`} term="tradeCount">
      {trades.length === 0 ? (
        <Empty>The strategy never entered a position in this period.</Empty>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="tabular w-full text-sm">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 text-left font-medium">#</th>
                <th className="pb-2 text-left font-medium">Entry</th>
                <th className="pb-2 font-medium">Entry price</th>
                <th className="pb-2 text-left font-medium pl-4">Exit</th>
                <th className="pb-2 font-medium">Exit price</th>
                <th className="pb-2 font-medium">Return</th>
                <th className="pb-2 font-medium">Trading days</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i} className="border-t border-slate-800 text-right">
                  <td className="py-1.5 text-left text-slate-500">{i + 1}</td>
                  <td className="text-left">{t.entry_date}</td>
                  <td>{num(t.entry_price)}</td>
                  <td className="pl-4 text-left">{t.open ? <span className="text-amber-400">open</span> : t.exit_date}</td>
                  <td>{num(t.exit_price)}</td>
                  <td className={signColor(t.return)}>{pct(t.return)}</td>
                  <td>{t.bars_held}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RebalanceTable({ rebalances, tickers }: { rebalances: NonNullable<BacktestResult["rebalances"]>; tickers: string[] }) {
  return (
    <Card title={`Rebalances (${rebalances.length})`} term="rebalanceFrequency">
      <div className="max-h-96 overflow-auto">
        <table className="tabular w-full text-xs">
          <thead className="sticky top-0 bg-slate-900">
            <tr className="text-right uppercase tracking-wide text-slate-500">
              <th className="pb-2 text-left font-medium">Date</th>
              <th className="pb-2 font-medium">
                <Term term="turnover">Traded</Term>
              </th>
              <th className="pb-2 font-medium">Cost</th>
              {tickers.map((t) => (
                <th key={t} className="pb-2 pl-3 font-mono font-medium normal-case">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rebalances.map((r) => (
              <tr key={r.date} className="border-t border-slate-800 text-right">
                <td className="py-1.5 text-left">{r.date}</td>
                <td>{pct(r.turnover, 1)}</td>
                <td>{pct(r.cost, 3)}</td>
                {tickers.map((t) => (
                  <td key={t} className="pl-3 text-slate-300">
                    {r.weights[t] == null ? <span className="text-slate-600">—</span> : pct(r.weights[t], 1)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Weights right after each rebalance. Traded is the value bought plus sold as a share of the portfolio.</p>
    </Card>
  );
}

function SavedRuns({
  runs,
  error,
  strategies,
  onLoad,
  onDelete,
  activeId,
}: {
  runs: BacktestRun[] | undefined;
  error: unknown;
  strategies: StrategyMeta[];
  onLoad: (run: BacktestRun) => void;
  onDelete: (id: number) => void;
  activeId: number | null;
}) {
  return (
    <Card title="Saved runs">
      <ErrorBox error={error} />
      {!runs ? (
        !error && <Spinner />
      ) : runs.length === 0 ? (
        <Empty>Every backtest you run is saved here with its settings and headline stats.</Empty>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="tabular w-full text-sm">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 text-left font-medium">Run</th>
                <th className="pb-2 text-left font-medium">Strategy</th>
                <th className="pb-2 text-left font-medium">Period</th>
                <th className="pb-2 font-medium">Costs (bps)</th>
                <th className="pb-2 font-medium"><Term term="annualReturn">CAGR</Term></th>
                <th className="pb-2 font-medium"><Term term="buyHold">B&amp;H CAGR</Term></th>
                <th className="pb-2 font-medium"><Term term="sharpe">Sharpe</Term></th>
                <th className="pb-2 font-medium"><Term term="maxDrawdown">Max DD</Term></th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const meta = strategies.find((s) => s.id === r.strategy_id);
                const st = r.summary.stats.strategy;
                return (
                  <tr key={r.id} className={`border-t border-slate-800 text-right ${r.id === activeId ? "bg-sky-500/5" : ""}`}>
                    <td className="py-1.5 text-left text-xs text-slate-500" title={r.created_at}>
                      {new Date(r.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="text-left">
                      <div className="text-slate-200">{meta?.name ?? r.strategy_id}</div>
                      <div className="text-xs text-slate-500">{paramSummary(meta, r.params)}</div>
                    </td>
                    <td className="text-left text-xs text-slate-400">
                      {BACKTEST_PERIODS.find((p) => p.value === r.config.period)?.label ?? r.config.period}
                      <div className="text-slate-600">
                        {r.summary.start} → {r.summary.end}
                      </div>
                    </td>
                    <td className="text-xs text-slate-400">
                      {num(r.config.commission_bps, 1)} + {num(r.config.slippage_bps, 1)}
                    </td>
                    <td className={signColor(st.annual_return)}>{pct(st.annual_return)}</td>
                    <td className="text-slate-400">{pct(r.summary.stats.buy_hold.annual_return)}</td>
                    <td className={sharpeColor(st.sharpe_ratio)}>{num(st.sharpe_ratio)}</td>
                    <td className="text-rose-400">{pct(st.max_drawdown)}</td>
                    <td className="whitespace-nowrap pl-3">
                      <Button size="sm" variant="ghost" onClick={() => onLoad(r)} disabled={!meta} title="Load these settings and run again">
                        Load
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => onDelete(r.id)} title="Delete this saved run">
                        Delete
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
