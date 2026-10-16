"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import useSWR, { useSWRConfig } from "swr";
import { api, fetcher, paths } from "@/lib/api";
import { compact, money, num, PALETTE, pct, signColor } from "@/lib/format";
import type { Evolution, ImportSummary, Portfolio, Transaction, TransactionPage } from "@/lib/types";
import { tooltipStyle } from "./AnalyticsView";
import { Button, Card, Empty, ErrorBox, Field, Input, Pager, Select, Spinner, Stat } from "./ui";

/** Value, invested capital and weights over time, rebuilt from the portfolio's trades. */
export function EvolutionPanel({ portfolio }: { portfolio: Portfolio }) {
  const hasTrades = portfolio.transaction_count > 0;
  const { data, error, isLoading } = useSWR<Evolution>(hasTrades ? paths.evolution(portfolio.id) : null, fetcher, { revalidateOnFocus: false });
  const currency = data && data.tickers.length > 0 && data.tickers.every((t) => t.endsWith(".SA")) ? "BRL" : null;
  const fmt = (v: number | null | undefined) => (currency ? money(v, currency) : num(v));

  return (
    <div className="flex flex-col gap-6">
      <ImportActions portfolio={portfolio} />
      {!hasTrades && <Empty>No trades yet. Import a B3 Negociação spreadsheet or add trades below to track positions and their evolution.</Empty>}
      {isLoading && <Spinner label="Replaying trades against market prices…" />}
      <ErrorBox error={error} />
      {hasTrades && data && (
        <>
          {data.warnings.length > 0 && (
            <ul className="space-y-1 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
              {data.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <EvolutionStats data={data} fmt={fmt} />
          <ValueChart data={data} fmt={fmt} />
          <WeightsChart data={data} />
          <PositionsTable data={data} fmt={fmt} />
        </>
      )}
      <TransactionsCard portfolio={portfolio} fmt={fmt} />
    </div>
  );
}

/** After the trades or holdings change, every view of the portfolio is stale. */
function usePortfolioRefresh(portfolioId: number) {
  const { mutate } = useSWRConfig();
  return (updated: Portfolio) => {
    mutate(paths.portfolio(portfolioId), updated, { revalidate: false });
    mutate((key) => typeof key === "string" && key.startsWith(`/portfolios/${portfolioId}/`));
    mutate("/portfolios");
  };
}

type Fmt = (v: number | null | undefined) => string;

function EvolutionStats({ data, fmt }: { data: Evolution; fmt: Fmt }) {
  const { value, cost, invested } = data.totals;
  const unrealized = value - cost;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Market value" value={fmt(value)} hint={`Prices of ${data.end}`} />
      <Stat
        label="Cost of open positions"
        value={fmt(cost)}
        info="What you paid for the shares you still hold (average cost)."
      />
      <Stat label="Unrealized gain" value={fmt(unrealized)} className={signColor(unrealized)} hint={cost > 0 ? pct(unrealized / cost) : undefined} />
      <Stat label="Net invested" value={fmt(invested)} hint="Purchases minus sale proceeds" />
    </div>
  );
}

function ValueChart({ data, fmt }: { data: Evolution; fmt: Fmt }) {
  return (
    <Card title={`Value vs net invested · ${data.start} → ${data.end}`}>
      <div className="h-72">
        <ResponsiveContainer>
          <LineChart data={data.points} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} minTickGap={50} />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={(v) => compact(v as number)} width={50} />
            <Tooltip {...tooltipStyle} formatter={(v) => fmt(v as number)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="value" name="Market value" stroke="#38bdf8" dot={false} strokeWidth={2} />
            <Line type="stepAfter" dataKey="invested" name="Net invested" stroke="#94a3b8" dot={false} strokeWidth={1.5} strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-slate-500">Net invested is purchases minus sale proceeds, so it drops when you take money out.</p>
    </Card>
  );
}

function WeightsChart({ data }: { data: Evolution }) {
  // Ticker symbols contain dots, which Recharts reads as nested paths, so key the series by index.
  const rows = data.points.map((p) => ({ date: p.date, ...Object.fromEntries(data.tickers.map((t, i) => [`w${i}`, p.weights[t] ?? 0])) }));
  return (
    <Card title="Weights over time">
      <div className="h-80">
        <ResponsiveContainer>
          <AreaChart data={rows} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} minTickGap={50} />
            <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={(v) => pct(v as number, 0)} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} width={45} />
            <Tooltip
              {...tooltipStyle}
              itemSorter={(item) => -(item.value as number)}
              formatter={(v, name) => ((v as number) > 0 ? [pct(v as number, 1), name] : [null, null])}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {data.tickers.map((t, i) => (
              <Area
                key={t}
                type="stepAfter"
                dataKey={`w${i}`}
                name={t.replace(/\.SA$/, "")}
                stackId="w"
                stroke={PALETTE[i % PALETTE.length]}
                fill={PALETTE[i % PALETTE.length]}
                fillOpacity={0.55}
                strokeWidth={1}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function PositionsTable({ data, fmt }: { data: Evolution; fmt: Fmt }) {
  return (
    <Card title="Open positions">
      <div className="overflow-x-auto">
        <table className="tabular w-full text-sm">
          <thead>
            <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
              <th className="pb-2 text-left font-medium">Ticker</th>
              <th className="pb-2 font-medium">Shares</th>
              <th className="pb-2 font-medium">Avg. cost</th>
              <th className="pb-2 font-medium">Price</th>
              <th className="pb-2 font-medium">Value</th>
              <th className="pb-2 font-medium">Weight</th>
              <th className="pb-2 font-medium">Unrealized</th>
            </tr>
          </thead>
          <tbody>
            {data.positions.map((p) => (
              <tr key={p.ticker} className="border-t border-slate-800 text-right">
                <td className="py-2 text-left font-mono">
                  <Link href={`/stocks?ticker=${encodeURIComponent(p.ticker)}`} className="text-white hover:text-sky-300">
                    {p.ticker}
                  </Link>
                </td>
                <td>{num(p.quantity, p.quantity % 1 ? 2 : 0)}</td>
                <td>{fmt(p.avg_price)}</td>
                <td>{fmt(p.price)}</td>
                <td>{fmt(p.value)}</td>
                <td>{pct(p.weight, 1)}</td>
                <td className={signColor(p.unrealized)}>
                  {fmt(p.unrealized)}
                  {p.cost ? <span className="ml-1 text-xs text-slate-500">{pct((p.unrealized ?? 0) / p.cost, 1)}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.positions.length === 0 && <p className="py-4 text-center text-sm text-slate-500">Every position has been closed.</p>}
      </div>
    </Card>
  );
}

function TransactionsCard({ portfolio, fmt }: { portfolio: Portfolio; fmt: Fmt }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refresh = usePortfolioRefresh(portfolio.id);
  const [page, setPage] = useState(0);
  const showTable = open && portfolio.transaction_count > 0;
  // Never ask for a page past the end (e.g. after deleting the last trade of the last page).
  const pages = Math.max(1, Math.ceil(portfolio.transaction_count / TRADES_PER_PAGE));
  const current = Math.min(page, pages - 1);
  const { data, error: loadError, isValidating } = useSWR<TransactionPage>(
    showTable ? paths.transactions(portfolio.id, TRADES_PER_PAGE, current * TRADES_PER_PAGE) : null,
    fetcher,
    { keepPreviousData: true },
  );
  const kindColor = { buy: "text-emerald-400", sell: "text-rose-400" };

  const remove = async (t: Transaction) => {
    if (!confirm(`Delete the ${t.kind} of ${t.quantity} ${t.ticker} on ${t.date}?`)) return;
    setDeleting(t.id);
    setError(null);
    try {
      refresh(await api.deleteTransaction(portfolio.id, t.id));
    } catch (err) {
      setError(err);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card
      title="Transactions"
      actions={
        portfolio.transaction_count > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide" : `Show ${portfolio.transaction_count}`}
          </Button>
        )
      }
    >
      <AddTradeForm portfolio={portfolio} onAdded={() => setOpen(true)} />
      <ErrorBox error={error || loadError} />
      {showTable && !data && !loadError && <Spinner />}
      {showTable && data && (
        <div className={`mt-4 overflow-x-auto transition ${isValidating ? "opacity-60" : ""}`}>
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 text-left font-medium">Date</th>
                <th className="pb-2 text-left font-medium">Ticker</th>
                <th className="pb-2 text-left font-medium">Type</th>
                <th className="pb-2 font-medium">Quantity</th>
                <th className="pb-2 font-medium">Price</th>
                <th className="pb-2 font-medium">Amount</th>
                <th className="pb-2 pl-3 text-left font-medium">Market</th>
                <th className="w-8 pb-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id} className="border-t border-slate-800 text-right">
                  <td className="py-1.5 text-left text-slate-400">{t.date}</td>
                  <td className="text-left font-mono text-white">{t.ticker}</td>
                  <td className={`text-left ${kindColor[t.kind]}`}>{t.kind}</td>
                  <td>{num(t.quantity, t.quantity % 1 ? 2 : 0)}</td>
                  <td>{fmt(t.price)}</td>
                  <td>{fmt(t.amount)}</td>
                  <td className="max-w-56 truncate pl-3 text-left text-xs text-slate-500">{t.movement}</td>
                  <td>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${t.kind} of ${t.ticker} on ${t.date}`} onClick={() => remove(t)} disabled={deleting !== null}>
                      {deleting === t.id ? "…" : "✕"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {data.total === 0 ? "No trades" : `${data.offset + 1}–${data.offset + data.items.length} of ${data.total} trades, newest first`}
            </span>
            <Pager page={current} pages={Math.ceil(data.total / TRADES_PER_PAGE)} onPage={setPage} />
          </div>
        </div>
      )}
    </Card>
  );
}

const TRADES_PER_PAGE = 25;

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

/** Record a buy or sell by hand; B3 codes like PETR4 are mapped to Yahoo symbols by the API. */
function AddTradeForm({ portfolio, onAdded }: { portfolio: Portfolio; onAdded: () => void }) {
  const refresh = usePortfolioRefresh(portfolio.id);
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<"buy" | "sell">("buy");
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [added, setAdded] = useState<string | null>(null);

  const qty = parseFloat(quantity);
  const unit = price.trim() === "" ? null : parseFloat(price);
  const valid = ticker.trim() !== "" && date !== "" && qty > 0 && (unit == null || unit > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    setAdded(null);
    try {
      refresh(await api.addTransaction(portfolio.id, { date, kind, ticker: ticker.trim(), quantity: qty, price: unit }));
      setAdded(`${kind === "buy" ? "Bought" : "Sold"} ${qty} ${ticker.trim().toUpperCase()} on ${date}`);
      setTicker("");
      setQuantity("");
      setPrice("");
      onAdded();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[auto_auto_1fr_1fr_1fr_auto] sm:items-end">
        <Field label="Date">
          <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="py-1.5" required />
        </Field>
        <Field label="Side">
          <Select value={kind} onChange={(e) => setKind(e.target.value as "buy" | "sell")} className="py-1.5">
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </Select>
        </Field>
        <Field label="Ticker">
          <Input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="PETR4" maxLength={20} className="py-1.5 font-mono" required />
        </Field>
        <Field label="Quantity">
          <Input type="number" step="any" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="py-1.5 text-right" required />
        </Field>
        <Field label="Unit price (optional)">
          <Input type="number" step="any" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="day's close" className="py-1.5 text-right" />
        </Field>
        <Button variant="primary" disabled={!valid || saving} className="col-span-2 sm:col-span-1">
          {saving ? "Adding…" : "Add trade"}
        </Button>
      </div>
      <ErrorBox error={error} />
      {added && <p className="text-xs text-emerald-400">{added}. Positions and weights were updated.</p>}
      {!portfolio.weights_as_of && portfolio.holdings.length > 0 && (
        <p className="text-xs text-slate-500">This portfolio uses fixed weights: trades update the evolution, and <em>Sync weights to positions</em> applies them to the holdings.</p>
      )}
    </form>
  );
}

/** Import or re-import a statement, or snap manually edited weights back to the positions. */
function ImportActions({ portfolio }: { portfolio: Portfolio }) {
  const refresh = usePortfolioRefresh(portfolio.id);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"import" | "sync" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const hasTrades = portfolio.transaction_count > 0;

  const reimport = async (file: File) => {
    if (hasTrades && !confirm("Replace all trades of this portfolio with the spreadsheet's?")) return;
    setBusy("import");
    setError(null);
    try {
      const result = await api.importTransactions(portfolio.id, file);
      setSummary(result.summary);
      refresh(result.portfolio);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const sync = async () => {
    setBusy("sync");
    setError(null);
    try {
      refresh(await api.syncPositions(portfolio.id));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const skipped = summary ? Object.entries(summary.skipped) : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">
          {portfolio.transaction_count} trades ·{" "}
          {portfolio.weights_as_of ? `weights follow the positions at prices of ${portfolio.weights_as_of}` : portfolio.holdings.length ? "holdings use fixed weights" : "no holdings yet"}
        </span>
        <div className="ml-auto flex gap-2">
          {hasTrades && !portfolio.weights_as_of && (
            <Button size="sm" onClick={sync} disabled={busy !== null} title="Replace the holdings with the open positions at current prices">
              {busy === "sync" ? "Syncing…" : "Sync weights to positions"}
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => input.current?.click()}
            disabled={busy !== null}
            title={hasTrades ? "Replace the trades with a newer B3 Negociação export" : "Load the trades from a B3 Negociação export"}
          >
            {busy === "import" ? "Importing…" : hasTrades ? "Re-import spreadsheet" : "Import spreadsheet"}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) reimport(f);
            }}
          />
        </div>
      </div>
      <ErrorBox error={error} />
      {summary && (
        <p className="text-xs text-emerald-400">
          Imported {summary.transactions} of {summary.rows} trades ({summary.start} → {summary.end}, {summary.tickers.length} tickers)
          {skipped.length > 0 && <span className="text-slate-500"> · skipped {skipped.map(([k, n]) => `${n} ${k}`).join(", ")}</span>}
        </p>
      )}
    </div>
  );
}
