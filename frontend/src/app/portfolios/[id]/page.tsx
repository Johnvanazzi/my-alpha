"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import useSWR from "swr";
import { AssetTable, CorrelationMatrix, GrowthChart, PortfolioStats, tooltipStyle } from "@/components/AnalyticsView";
import { HoldingsEditor, type HoldingRow, toHoldings, toRows, validateRows } from "@/components/HoldingsEditor";
import { Button, Card, Empty, ErrorBox, Input, PageHeader, Segmented, Spinner } from "@/components/ui";
import { api, fetcher, paths } from "@/lib/api";
import { compactMoney, num, PALETTE, pct, PERIODS } from "@/lib/format";
import type { Analytics, Composition, Portfolio } from "@/lib/types";

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

  const [period, setPeriod] = useState("1y");
  const [rfInput, setRfInput] = useState("");
  const rf = rfInput.trim() === "" ? null : parseFloat(rfInput) / 100;

  // Reset the editor whenever fresh data arrives and there are no local edits.
  useEffect(() => {
    if (portfolio && !dirty) {
      setRows(toRows(portfolio.holdings));
      setName(portfolio.name);
    }
  }, [portfolio, dirty]);

  const hasHoldings = (portfolio?.holdings.length ?? 0) > 0;
  const analytics = useSWR<Analytics>(hasHoldings ? paths.analytics(id, period, rf != null && !isNaN(rf) ? rf : null) : null, fetcher, { revalidateOnFocus: false });
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
      analytics.mutate();
      composition.mutate();
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
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]">
        <div className="flex flex-col gap-6">
          <Card
            title="Holdings"
            actions={
              dirty && (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setDirty(false)}>
                    Discard
                  </Button>
                  <Button size="sm" variant="primary" onClick={save} disabled={saving || !!validation}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              )
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
            <div className="mt-2">
              <ErrorBox error={saveError} />
            </div>
          </Card>

          {composition.data && <AllocationCard composition={composition.data} />}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {!hasHoldings ? (
            <Empty>Add holdings and save to see allocation, risk and performance analytics.</Empty>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented options={ANALYTICS_PERIODS} value={period} onChange={setPeriod} />
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  Risk-free rate %
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
              {analytics.isLoading && <Spinner label="Downloading prices and computing statistics…" />}
              <ErrorBox error={analytics.error} />
              {analytics.data && (
                <>
                  <PortfolioStats a={analytics.data} />
                  <GrowthChart a={analytics.data} />
                  <AssetTable a={analytics.data} />
                  <CorrelationMatrix a={analytics.data} />
                </>
              )}
              {composition.data && <CompositionTable composition={composition.data} />}
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
              <th className="pb-2 font-medium">Market cap</th>
              <th className="pb-2 font-medium">P/E</th>
              <th className="pb-2 font-medium">Beta</th>
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
                  <Link href={`/fundamentals?ticker=${encodeURIComponent(h.ticker)}`} className="text-sky-400 hover:underline">
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
