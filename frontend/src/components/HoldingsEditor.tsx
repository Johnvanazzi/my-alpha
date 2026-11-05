"use client";

import type { HoldingInput } from "@/lib/types";
import { Term } from "./InfoTip";
import { TickerSearch } from "./TickerSearch";
import { Button, cx } from "./ui";

/** Editable row; weight is kept as the raw text the user typed (in percent). */
export interface HoldingRow {
  ticker: string;
  weightPct: string;
}

export const toRows = (holdings: HoldingInput[]): HoldingRow[] =>
  holdings.map((h) => ({ ticker: h.ticker, weightPct: String(+(h.weight * 100).toFixed(4)) }));

export const toHoldings = (rows: HoldingRow[]): HoldingInput[] =>
  rows.filter((r) => r.ticker.trim()).map((r) => ({ ticker: r.ticker.trim().toUpperCase(), weight: (parseFloat(r.weightPct) || 0) / 100 }));

export function totalPct(rows: HoldingRow[]): number {
  return rows.reduce((sum, r) => sum + (parseFloat(r.weightPct) || 0), 0);
}

/** Returns a message if the rows can't be saved, otherwise null. */
export function validateRows(rows: HoldingRow[]): string | null {
  const tickers = rows.map((r) => r.ticker.trim().toUpperCase()).filter(Boolean);
  if (new Set(tickers).size !== tickers.length) return "Each ticker can only appear once.";
  if (rows.some((r) => r.ticker.trim() && !(parseFloat(r.weightPct) > 0))) return "Every weight must be greater than 0%.";
  if (totalPct(rows) > 100.0001) return "Weights add up to more than 100%.";
  return null;
}

export type HoldingsView = "category" | "weight";

const UNCATEGORIZED = "Uncategorized";

interface Props {
  rows: HoldingRow[];
  onChange: (rows: HoldingRow[]) => void;
  /** Category per ticker; tickers missing from it (e.g. added but not saved yet) are uncategorized. */
  categories?: Record<string, string>;
  /** Saved weight per ticker, used for ordering so rows don't jump around while a weight is typed. */
  savedWeights?: Record<string, number>;
  view?: HoldingsView;
}

export function HoldingsEditor({ rows, onChange, categories, savedWeights = {}, view = "weight" }: Props) {
  const total = totalPct(rows);
  const update = (i: number, patch: Partial<HoldingRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Largest saved weight first; new rows keep the order they were added in, at the end.
  const ordered = rows.map((r, i) => ({ r, i })).sort((a, b) => (savedWeights[b.r.ticker] ?? -1) - (savedWeights[a.r.ticker] ?? -1));
  const groups: { name: string | null; items: typeof ordered }[] = [];
  if (view === "category" && categories) {
    const byName = new Map<string, typeof ordered>();
    for (const item of ordered) {
      const name = categories[item.r.ticker] ?? UNCATEGORIZED;
      byName.set(name, [...(byName.get(name) ?? []), item]);
    }
    const weightOf = (items: typeof ordered) => items.reduce((s, { r }) => s + (parseFloat(r.weightPct) || 0), 0);
    groups.push(
      ...[...byName.entries()]
        .map(([name, items]) => ({ name, items }))
        .sort((a, b) => (a.name === UNCATEGORIZED ? 1 : b.name === UNCATEGORIZED ? -1 : weightOf(b.items) - weightOf(a.items))),
    );
  } else {
    groups.push({ name: null, items: ordered });
  }

  const row = ({ r, i }: (typeof ordered)[number]) => (
    <tr key={i} className="border-t border-slate-800">
      <td className="py-1.5 pr-2">
        <input
          value={r.ticker}
          onChange={(e) => update(i, { ticker: e.target.value.toUpperCase() })}
          className="w-full rounded border border-transparent bg-transparent px-2 py-1 font-mono text-white hover:border-slate-700 focus:border-sky-500 focus:outline-none"
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          type="number"
          step="any"
          min={0}
          max={100}
          value={r.weightPct}
          onChange={(e) => update(i, { weightPct: e.target.value })}
          className="tabular w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-right text-white focus:border-sky-500 focus:outline-none"
        />
      </td>
      <td className="py-1.5 text-right">
        <Button size="sm" variant="ghost" aria-label={`Remove ${r.ticker}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
          ✕
        </Button>
      </td>
    </tr>
  );

  const add = (symbol: string) => {
    if (rows.some((r) => r.ticker.toUpperCase() === symbol)) return;
    const remaining = Math.max(0, 100 - total);
    onChange([...rows, { ticker: symbol, weightPct: remaining > 0 ? String(+remaining.toFixed(2)) : "" }]);
  };

  const normalize = () => {
    if (total <= 0) return;
    onChange(rows.map((r) => ({ ...r, weightPct: String(+(((parseFloat(r.weightPct) || 0) / total) * 100).toFixed(4)) })));
  };

  const equalWeight = () => {
    if (!rows.length) return;
    onChange(rows.map((r) => ({ ...r, weightPct: String(+(100 / rows.length).toFixed(4)) })));
  };

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="pb-2 font-medium">Ticker</th>
            <th className="w-32 pb-2 font-medium"><Term term="weight">Weight %</Term></th>
            <th className="w-10 pb-2" />
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.name ?? "all"}>
            {g.name && (
              <tr className="border-t border-slate-700">
                <td className="pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-300">
                  {g.name} <span className="font-normal normal-case text-slate-500">· {g.items.length}</span>
                </td>
                <td className="tabular pb-1 pr-4 pt-3 text-right text-xs font-semibold text-slate-300">
                  {g.items.reduce((s, { r }) => s + (parseFloat(r.weightPct) || 0), 0).toFixed(2)}%
                </td>
                <td />
              </tr>
            )}
            {g.items.map(row)}
          </tbody>
        ))}
        <tfoot>
          <tr className="border-t border-slate-700">
            <td className="pt-2 text-xs uppercase tracking-wide text-slate-500">Total</td>
            <td className={cx("tabular pt-2 pr-4 text-right font-semibold", Math.abs(total - 100) < 0.01 ? "text-emerald-400" : total > 100 ? "text-rose-400" : "text-amber-400")}>
              {total.toFixed(2)}%
            </td>
            <td />
          </tr>
        </tfoot>
      </table>

      <TickerSearch onSelect={add} placeholder="Add a ticker…" />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={normalize} disabled={total <= 0}>
          Scale to 100%
        </Button>
        <Button size="sm" onClick={equalWeight} disabled={!rows.length}>
          Equal weight
        </Button>
      </div>
      {total < 99.99 && total > 0 && (
        <p className="text-xs text-slate-500">The remaining {(100 - total).toFixed(2)}% is ignored: analytics rescale weights to 100%.</p>
      )}
    </div>
  );
}
