"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Button, Card, cx, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { api, fetcher, paths } from "@/lib/api";
import { compact, num, pctRaw, signColor } from "@/lib/format";
import type { ScreenerFilters, ScreenerMeta, ScreenerResult } from "@/lib/types";

const REGIONS = [
  { value: "us", label: "United States" },
  { value: "br", label: "Brazil" },
  { value: "ca", label: "Canada" },
  { value: "gb", label: "United Kingdom" },
  { value: "de", label: "Germany" },
  { value: "fr", label: "France" },
  { value: "jp", label: "Japan" },
  { value: "hk", label: "Hong Kong" },
  { value: "in", label: "India" },
  { value: "au", label: "Australia" },
];

const SORT_LABELS: Record<string, string> = {
  market_cap: "Market cap",
  change_percent: "Day change",
  pe: "P/E",
  volume: "Volume",
  dividend_yield: "Dividend yield",
};

const BILLION = 1e9;

interface FormState {
  region: string;
  sector: string;
  minCapB: string;
  maxCapB: string;
  minPe: string;
  maxPe: string;
  minDiv: string;
  minRevGrowth: string;
  minPrice: string;
  sortBy: string;
  sortAsc: boolean;
}

const INITIAL: FormState = {
  region: "us",
  sector: "",
  minCapB: "10",
  maxCapB: "",
  minPe: "",
  maxPe: "",
  minDiv: "",
  minRevGrowth: "",
  minPrice: "",
  sortBy: "market_cap",
  sortAsc: false,
};

const n = (v: string) => (v.trim() === "" || isNaN(Number(v)) ? null : Number(v));

function toFilters(f: FormState): ScreenerFilters {
  const minCap = n(f.minCapB);
  const maxCap = n(f.maxCapB);
  return {
    region: f.region,
    sector: f.sector || null,
    min_market_cap: minCap == null ? null : minCap * BILLION,
    max_market_cap: maxCap == null ? null : maxCap * BILLION,
    min_pe: n(f.minPe),
    max_pe: n(f.maxPe),
    min_dividend_yield: n(f.minDiv),
    min_revenue_growth: n(f.minRevGrowth),
    min_price: n(f.minPrice),
    sort_by: f.sortBy,
    sort_asc: f.sortAsc,
    limit: 100,
  };
}

export default function ScreenerPage() {
  const { data: meta } = useSWR<ScreenerMeta>(paths.screenerMeta, fetcher, { revalidateOnFocus: false });
  const [mode, setMode] = useState<"custom" | string>("custom");
  const [form, setForm] = useState<FormState>(INITIAL);
  const [result, setResult] = useState<ScreenerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const run = async (load: () => Promise<ScreenerResult>) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await load());
    } catch (err) {
      setError(err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const runCustom = (e?: React.FormEvent) => {
    e?.preventDefault();
    setMode("custom");
    run(() => api.screen(toFilters(form)));
  };

  const runPreset = (id: string) => {
    setMode(id);
    run(() => fetcher<ScreenerResult>(paths.preset(id)));
  };

  return (
    <>
      <PageHeader title="Stock Screener" subtitle="Filter equities with Yahoo Finance's screener." />

      <div className="mb-4 flex flex-wrap gap-2">
        {meta?.presets.map((p) => (
          <button
            key={p.id}
            onClick={() => runPreset(p.id)}
            className={cx(
              "rounded-full border px-3 py-1 text-xs transition",
              mode === p.id ? "border-sky-500 bg-sky-500/10 text-sky-300" : "border-slate-700 text-slate-400 hover:text-slate-200",
            )}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card title="Custom filters">
          <form onSubmit={runCustom} className="flex flex-col gap-3">
            <Field label="Region">
              <Select value={form.region} onChange={(e) => set("region", e.target.value)}>
                {REGIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sector">
              <Select value={form.sector} onChange={(e) => set("sector", e.target.value)}>
                <option value="">All sectors</option>
                {meta?.sectors.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Min mkt cap ($B)">
                <Input type="number" step="any" value={form.minCapB} onChange={(e) => set("minCapB", e.target.value)} />
              </Field>
              <Field label="Max mkt cap ($B)">
                <Input type="number" step="any" value={form.maxCapB} onChange={(e) => set("maxCapB", e.target.value)} />
              </Field>
              <Field label="Min P/E">
                <Input type="number" step="any" value={form.minPe} onChange={(e) => set("minPe", e.target.value)} />
              </Field>
              <Field label="Max P/E">
                <Input type="number" step="any" value={form.maxPe} onChange={(e) => set("maxPe", e.target.value)} />
              </Field>
              <Field label="Min div. yield %">
                <Input type="number" step="any" value={form.minDiv} onChange={(e) => set("minDiv", e.target.value)} />
              </Field>
              <Field label="Min rev. growth %">
                <Input type="number" step="any" value={form.minRevGrowth} onChange={(e) => set("minRevGrowth", e.target.value)} />
              </Field>
              <Field label="Min price">
                <Input type="number" step="any" value={form.minPrice} onChange={(e) => set("minPrice", e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <Field label="Sort by">
                <Select value={form.sortBy} onChange={(e) => set("sortBy", e.target.value)}>
                  {(meta?.sort_fields ?? Object.keys(SORT_LABELS)).map((s) => (
                    <option key={s} value={s}>
                      {SORT_LABELS[s] ?? s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="button" onClick={() => set("sortAsc", !form.sortAsc)} title="Toggle sort direction">
                {form.sortAsc ? "↑" : "↓"}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" disabled={loading}>
                Run screen
              </Button>
              <Button type="button" variant="ghost" onClick={() => setForm(INITIAL)}>
                Reset
              </Button>
            </div>
          </form>
        </Card>

        <Card title={result ? `${result.results.length} of ${result.total.toLocaleString()} matches` : "Results"}>
          {loading && <Spinner />}
          <ErrorBox error={error} />
          {!loading && !result && !error && <Empty>Pick a preset above or run a custom screen.</Empty>}
          {!loading && result && result.results.length === 0 && <Empty>No stocks match these filters.</Empty>}
          {!loading && result && result.results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="tabular w-full text-sm">
                <thead>
                  <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 text-left font-medium">Symbol</th>
                    <th className="pb-2 text-left font-medium">Name</th>
                    <th className="pb-2 font-medium">Price</th>
                    <th className="pb-2 font-medium">Day</th>
                    <th className="pb-2 font-medium">52w</th>
                    <th className="pb-2 font-medium">Mkt cap</th>
                    <th className="pb-2 font-medium">P/E</th>
                    <th className="pb-2 font-medium">Fwd P/E</th>
                    <th className="pb-2 font-medium">EPS</th>
                    <th className="pb-2 font-medium">Div %</th>
                    <th className="pb-2 font-medium">Volume</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r) => (
                    <tr key={r.symbol} className="border-t border-slate-800 text-right hover:bg-slate-800/40">
                      <td className="py-2 text-left font-mono">
                        <Link href={`/technical?ticker=${encodeURIComponent(r.symbol)}`} className="text-white hover:text-sky-300">
                          {r.symbol}
                        </Link>
                      </td>
                      <td className="max-w-56 truncate text-left text-slate-300" title={r.name ?? ""}>
                        {r.name}
                      </td>
                      <td>{num(r.price)}</td>
                      <td className={signColor(r.change_percent)}>{pctRaw(r.change_percent)}</td>
                      <td className={signColor(r.fifty_two_week_change_percent)}>{pctRaw(r.fifty_two_week_change_percent, 1)}</td>
                      <td>{compact(r.market_cap)}</td>
                      <td>{num(r.trailing_pe, 1)}</td>
                      <td>{num(r.forward_pe, 1)}</td>
                      <td>{num(r.eps_ttm)}</td>
                      <td>{r.dividend_yield != null ? num(r.dividend_yield) : "—"}</td>
                      <td>{compact(r.volume, 1)}</td>
                      <td className="whitespace-nowrap pl-3 text-xs">
                        <Link href={`/fundamentals?ticker=${encodeURIComponent(r.symbol)}`} className="text-sky-400 hover:underline">
                          Financials
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
