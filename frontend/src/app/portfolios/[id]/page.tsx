"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import useSWR, { useSWRConfig } from "swr";
import { AssetTable, GrowthChart, PortfolioStats, tooltipStyle } from "@/components/AnalyticsView";
import { BacktestPanel } from "@/components/BacktestPanel";
import { EvolutionPanel } from "@/components/EvolutionView";
import { HrpPanel } from "@/components/HrpView";
import { TearsheetPanel } from "@/components/TearsheetView";
import { BenchmarkPicker } from "@/components/BenchmarkPicker";
import { Term } from "@/components/InfoTip";
import { HoldingsEditor, type HoldingRow, toHoldings, toRows, validateRows } from "@/components/HoldingsEditor";
import { Button, Card, Empty, ErrorBox, Input, PageHeader, Segmented, Spinner } from "@/components/ui";
import { api, fetcher, paths } from "@/lib/api";
import { compactMoney, num, PALETTE, pct, PERIODS } from "@/lib/format";
import type { Analytics, Composition, Portfolio } from "@/lib/types";

type Tab = "evolution" | "performance" | "rolling" | "hrp" | "backtest";
const TABS: { value: Tab; label: string }[] = [
  { value: "evolution", label: "Evolution" },
  { value: "performance", label: "Performance" },
  { value: "rolling", label: "Rolling & drawdowns" },
  { value: "hrp", label: "Risk parity (HRP)" },
  { value: "backtest", label: "Backtest" },
];

const COLLAPSED_KEY = "my-alpha:holdings-collapsed";

const ANALYTICS_PERIODS = PERIODS.filter((p) => ["3mo", "6mo", "ytd", "1y", "2y", "5y", "10y"].includes(p.value));

export default function PortfolioPage() {
  const { id } = useParams<{ id: string }>();
  const { data: portfolio, error, mutate } = useSWR<Portfolio>(paths.portfolio(id), fetcher);

  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");

  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [copying, setCopying] = useState(false);
  const [period, setPeriod] = useState("1y");
  const [tab, setTab] = useState<Tab>("performance");
  const { mutate: mutateAll } = useSWRConfig();
  const [rfInput, setRfInput] = useState("");
  const rfParsed = rfInput.trim() === "" ? null : parseFloat(rfInput) / 100;
  const rf = rfParsed != null && !isNaN(rfParsed) ? rfParsed : null;

  // Remember whether the holdings panel is collapsed, per browser.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {}
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  };

  // Deep link to a tab, e.g. ?tab=evolution right after an import.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some((t) => t.value === requested)) setTab(requested as Tab);
  }, []);

  // Portfolios without holdings are built through trades: stay on that tab once the first one lands.
  const empty = portfolio?.holdings.length === 0;
  useEffect(() => {
    if (empty) setTab("evolution");
  }, [empty]);

  // Reset the editor whenever fresh data arrives and there are no local edits.
  useEffect(() => {
    if (portfolio && !dirty) {
      setRows(toRows(portfolio.holdings));
      setName(portfolio.name);
    }
  }, [portfolio, dirty]);

  const hasHoldings = (portfolio?.holdings.length ?? 0) > 0;
  const analytics = useSWR<Analytics>(
    hasHoldings && portfolio ? paths.analytics(id, period, rf, portfolio.benchmark) : null, fetcher, { revalidateOnFocus: false });
  const composition = useSWR<Composition>(hasHoldings ? paths.composition(id) : null, fetcher, { revalidateOnFocus: false });

  if (error) return <ErrorBox error={error} />;
  if (!portfolio) return <Spinner />;

  const validation = validateRows(rows);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.replaceHoldings(portfolio.id, toHoldings(rows));
      setDirty(false);
      await mutate(updated, { revalidate: false });
      // Every analytics view of this portfolio (performance, HRP, tearsheet) is now stale.
      mutateAll((key) => typeof key === "string" && key.startsWith(`/portfolios/${portfolio.id}/`));
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const rename = async () => {
    if (name.trim() && name.trim() !== portfolio.name) await mutate(api.updatePortfolio(portfolio.id, { name: name.trim() }), { revalidate: false });
    setEditingName(false);
  };

  const duplicate = async () => {
    setCopying(true);
    try {
      const copy = await api.copyPortfolio(portfolio.id);
      mutateAll("/portfolios");
      router.push(`/portfolios/${copy.id}`);
    } catch (err) {
      setSaveError(err);
      setCopying(false);
    }
  };

  const changeBenchmark = (benchmark: string) => {
    if (benchmark !== portfolio.benchmark) mutate(api.updatePortfolio(portfolio.id, { benchmark }), { revalidate: false });
  };

  return (
    <>
      <PageHeader
        title={
          editingName ? (
            <form onSubmit={(e) => (e.preventDefault(), rename())} className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus onBlur={rename} className="text-lg" />
            </form>
          ) : (
            <button onClick={() => setEditingName(true)} className="text-left hover:text-sky-300" title="Rename">
              {portfolio.name}
            </button>
          )
        }
        subtitle={
          <>
            <Link href="/portfolios" className="hover:underline">
              Portfolios
            </Link>
            {portfolio.description && ` · ${portfolio.description}`}
          </>
        }
        actions={
          <Button size="sm" onClick={duplicate} disabled={copying} title="Create a copy with the same holdings, description and benchmark">
            {copying ? "Copying…" : "Duplicate"}
          </Button>
        }
      />

      <div className={collapsed ? "grid gap-6" : "grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]"}>
        {collapsed && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Holdings</h2>
            <span className="text-xs text-slate-500">
              {portfolio.holdings.length} tickers · {pct(portfolio.total_weight, 1)}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5 overflow-hidden" style={{ maxHeight: 24 }}>
              {portfolio.holdings.map((h) => (
                <span key={h.id} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">
                  {h.ticker} {pct(h.weight, 1)}
                </span>
              ))}
            </div>
            {dirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
            <Button size="sm" onClick={toggleCollapsed} aria-expanded={false}>
              Expand ▸
            </Button>
          </div>
        )}
        <div className={collapsed ? "hidden" : "flex flex-col gap-6"}>
          <Card
            title="Holdings"
            actions={
              <div className="flex gap-2">
                {dirty && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setDirty(false)}>
                      Discard
                    </Button>
                    <Button size="sm" variant="primary" onClick={save} disabled={saving || !!validation}>
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={toggleCollapsed} aria-expanded={true} title="Collapse to give the analytics the full width">
                  ◂ Collapse
                </Button>
              </div>
            }
          >
            <HoldingsEditor
              rows={rows}
              onChange={(r) => {
                setRows(r);
                setDirty(true);
              }}
            />
            {dirty && validation && <p className="mt-2 text-xs text-rose-400">{validation}</p>}
            {portfolio.weights_as_of && (
              <p className="mt-2 text-xs text-slate-500">
                Weights follow the positions built from your trades at market prices of {portfolio.weights_as_of} and update each time the portfolio is opened.
                {dirty && <span className="text-amber-400"> Saving manual weights turns them into fixed targets.</span>}
              </p>
            )}
            <div className="mt-2">
              <ErrorBox error={saveError} />
            </div>
          </Card>

          {composition.data && <AllocationCard composition={composition.data} />}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {!hasHoldings ? (
            <>
              <Empty>Add holdings and save, or add trades below, to see allocation, risk and performance analytics.</Empty>
              <EvolutionPanel portfolio={portfolio} />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* The backtest tab has its own period (it allows longer histories). */}
                {tab === "backtest" || tab === "evolution" ? <span /> : <Segmented options={ANALYTICS_PERIODS} value={period} onChange={setPeriod} />}
                <BenchmarkPicker value={portfolio.benchmark} onChange={changeBenchmark} />
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <Term term="riskFree">Risk-free rate %</Term>
                  <Input
                    type="number"
                    step="any"
                    value={rfInput}
                    onChange={(e) => setRfInput(e.target.value)}
                    placeholder={analytics.data ? (analytics.data.risk_free_rate * 100).toFixed(2) : "T-bill"}
                    className="w-24 py-1 text-right"
                  />
                </label>
              </div>
              {dirty && <p className="text-xs text-amber-400">Analytics reflect the saved holdings. Save to update them.</p>}
              <div className="border-b border-slate-800">
                <nav className="-mb-px flex gap-4">
                  {TABS.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setTab(t.value)}
                      className={`border-b-2 px-1 pb-2 text-sm transition ${tab === t.value ? "border-sky-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </nav>
              </div>

              {tab === "evolution" && <EvolutionPanel portfolio={portfolio} />}
              {tab === "performance" && (
                <>
                  {analytics.isLoading && <Spinner label="Downloading prices and computing statistics…" />}
                  <ErrorBox error={analytics.error} />
                  {analytics.data?.benchmark_error && <p className="text-xs text-amber-400">{analytics.data.benchmark_error}</p>}
                  {analytics.data && (
                    <>
                      <PortfolioStats a={analytics.data} />
                      <GrowthChart a={analytics.data} />
                      <AssetTable a={analytics.data} />
                    </>
                  )}
                  {collapsed && composition.data && <AllocationCard composition={composition.data} />}
                  {composition.data && <CompositionTable composition={composition.data} />}
                </>
              )}
              {tab === "rolling" && <TearsheetPanel portfolioId={portfolio.id} period={period} rf={rf} benchmark={portfolio.benchmark} />}
              {tab === "hrp" &&
                (portfolio.holdings.length < 2 ? (
                  <Empty>Hierarchical Risk Parity needs at least two holdings.</Empty>
                ) : (
                  <HrpPanel portfolioId={portfolio.id} period={period} rf={rf} />
                ))}
              {tab === "backtest" && <BacktestPanel target={{ type: "portfolio", portfolio_id: portfolio.id }} benchmark={portfolio.benchmark} rf={rf} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function AllocationPie({ data }: { data: { name: string; weight: number }[] }) {
  return (
    <div className="flex items-center gap-4">
      <div className="h-40 w-40 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="weight" nameKey="name" innerRadius="55%" outerRadius="100%" stroke="#0f172a" isAnimationActive={false}>
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} itemStyle={{ color: "#e2e8f0" }} formatter={(v) => pct(v as number)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-1 text-xs">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="truncate text-slate-300">{d.name}</span>
            <span className="tabular ml-auto text-slate-400">{pct(d.weight, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AllocationCard({ composition }: { composition: Composition }) {
  const [by, setBy] = useState<"holding" | "sector" | "country">("holding");
  const total = composition.holdings.reduce((s, h) => s + h.weight, 0) || 1;
  const normalized = (items: { name: string; weight: number }[]) => items.map((i) => ({ ...i, weight: i.weight / total }));
  const data =
    by === "holding"
      ? normalized(composition.holdings.map((h) => ({ name: h.ticker, weight: h.weight })))
      : normalized(by === "sector" ? composition.by_sector : composition.by_country);

  return (
    <Card
      title="Allocation"
      actions={
        <Segmented
          options={[
            { value: "holding", label: "Holding" },
            { value: "sector", label: "Sector" },
            { value: "country", label: "Country" },
          ]}
          value={by}
          onChange={setBy}
        />
      }
    >
      <AllocationPie data={data} />
    </Card>
  );
}

function CompositionTable({ composition }: { composition: Composition }) {
  return (
    <Card title="Holdings detail">
      <div className="overflow-x-auto">
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
              <th className="pb-2 text-left font-medium">Ticker</th>
              <th className="pb-2 text-left font-medium">Name</th>
              <th className="pb-2 text-left font-medium">Sector</th>
              <th className="pb-2 font-medium">Price</th>
              <th className="pb-2 font-medium"><Term term="marketCap">Market cap</Term></th>
              <th className="pb-2 font-medium"><Term term="pe">P/E</Term></th>
              <th className="pb-2 font-medium"><Term text="Sensitivity of the stock to the overall market (as reported by Yahoo, usually vs the S&P 500 over 5 years of monthly returns).">Beta</Term></th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {composition.holdings.map((h) => (
              <tr key={h.ticker} className="border-t border-slate-800 text-right">
                <td className="py-2 text-left font-mono text-white">{h.ticker}</td>
                <td className="max-w-48 truncate text-left text-slate-300">{h.name ?? "—"}</td>
                <td className="text-left text-slate-400">{h.sector}</td>
                <td>{num(h.price)}</td>
                <td>{compactMoney(h.market_cap, h.currency)}</td>
                <td>{num(h.trailing_pe, 1)}</td>
                <td>{num(h.beta)}</td>
                <td className="whitespace-nowrap pl-3 text-xs">
                  <Link href={`/stocks?ticker=${encodeURIComponent(h.ticker)}#fundamentals`} className="text-sky-400 hover:underline">
                    Fundamentals
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
