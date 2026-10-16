"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Term } from "@/components/InfoTip";
import { Button, Card, cx, Empty, ErrorBox, Field, Input, PageHeader, Pager, Select, Spinner } from "@/components/ui";
import { api, fetcher, paths } from "@/lib/api";
import { compact, num, pct, pctRaw, signColor } from "@/lib/format";
import type { GlossaryKey } from "@/lib/glossary";
import type { ScreenerFilterMeta, ScreenerFilters, ScreenerMeta, ScreenerResult, ScreenerRow } from "@/lib/types";

const REGIONS = [
  { value: "us", label: "United States" },
  { value: "br", label: "Brazil" },
  { value: "ca", label: "Canada" },
  { value: "mx", label: "Mexico" },
  { value: "gb", label: "United Kingdom" },
  { value: "de", label: "Germany" },
  { value: "fr", label: "France" },
  { value: "it", label: "Italy" },
  { value: "es", label: "Spain" },
  { value: "nl", label: "Netherlands" },
  { value: "ch", label: "Switzerland" },
  { value: "se", label: "Sweden" },
  { value: "jp", label: "Japan" },
  { value: "hk", label: "Hong Kong" },
  { value: "cn", label: "China" },
  { value: "kr", label: "South Korea" },
  { value: "tw", label: "Taiwan" },
  { value: "in", label: "India" },
  { value: "sg", label: "Singapore" },
  { value: "au", label: "Australia" },
];

const PAGE_SIZES = [25, 50, 100];

/** Range inputs kept as raw strings while typing; the key is the backend filter key. */
type RangeDraft = Record<string, { min: string; max: string }>;

interface FormState {
  region: string;
  sector: string;
  excludeOtc: boolean;
  ranges: RangeDraft;
}

const INITIAL: FormState = { region: "us", sector: "", excludeOtc: true, ranges: { market_cap: { min: "10", max: "" } } };

const toNumber = (v: string | undefined) => (v == null || v.trim() === "" || isNaN(Number(v)) ? null : Number(v));

function toRanges(draft: RangeDraft): ScreenerFilters["ranges"] {
  const out: ScreenerFilters["ranges"] = {};
  for (const [key, { min, max }] of Object.entries(draft)) {
    const lo = toNumber(min);
    const hi = toNumber(max);
    if (lo != null || hi != null) out[key] = { min: lo, max: hi };
  }
  return out;
}

/** Columns: `sort` is the backend sort key when the column can be sorted server-side. */
interface Column {
  label: string;
  term?: GlossaryKey;
  sort?: string;
  render: (r: ScreenerRow) => React.ReactNode;
  className?: (r: ScreenerRow) => string;
}

const COLUMNS: Column[] = [
  { label: "Price", sort: "price", render: (r) => num(r.price) },
  { label: "Day", term: "dayChange", sort: "change_percent", render: (r) => pctRaw(r.change_percent), className: (r) => signColor(r.change_percent) },
  {
    label: "52w",
    term: "week52Change",
    sort: "change_52w",
    render: (r) => pctRaw(r.fifty_two_week_change_percent, 1),
    className: (r) => signColor(r.fifty_two_week_change_percent),
  },
  { label: "vs 200d", term: "vs200d", render: (r) => pct(r.vs_200d_percent, 1), className: (r) => signColor(r.vs_200d_percent) },
  { label: "Mkt cap", term: "marketCap", sort: "market_cap", render: (r) => compact(r.market_cap) },
  { label: "P/E", term: "pe", sort: "pe", render: (r) => num(r.trailing_pe, 1) },
  { label: "Fwd P/E", term: "forwardPe", render: (r) => num(r.forward_pe, 1) },
  { label: "P/B", term: "priceToBook", render: (r) => num(r.price_to_book, 1) },
  { label: "EPS", term: "epsTtm", render: (r) => num(r.eps_ttm) },
  { label: "Div %", term: "dividendYield", sort: "dividend_yield", render: (r) => (r.dividend_yield != null ? num(r.dividend_yield) : "—") },
  { label: "Volume", term: "volume", sort: "volume", render: (r) => compact(r.volume, 1) },
  { label: "Avg vol", term: "avgVolume", sort: "avg_volume", render: (r) => compact(r.avg_volume, 1) },
  { label: "Analysts", term: "analystRating", render: (r) => <span className="whitespace-nowrap text-slate-400">{r.analyst_rating ?? "—"}</span> },
];

const EXTRA_SORTS: Record<string, string> = { roe: "Return on equity", revenue_growth: "Revenue growth", beta: "Beta" };

function RangeInputs({ meta, value, onChange }: { meta: ScreenerFilterMeta; value?: { min: string; max: string }; onChange: (v: { min: string; max: string }) => void }) {
  const v = value ?? { min: "", max: "" };
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
      <span className="truncate text-xs text-slate-400" title={meta.label}>
        {meta.label}
        {meta.unit && <span className="ml-1 text-slate-600">({meta.unit})</span>}
      </span>
      <Input type="number" step="any" placeholder="min" value={v.min} onChange={(e) => onChange({ ...v, min: e.target.value })} className="w-20 px-2 py-1 text-right text-xs" />
      <Input type="number" step="any" placeholder="max" value={v.max} onChange={(e) => onChange({ ...v, max: e.target.value })} className="w-20 px-2 py-1 text-right text-xs" />
    </div>
  );
}

export default function ScreenerPage() {
  const { data: meta } = useSWR<ScreenerMeta>(paths.screenerMeta, fetcher, { revalidateOnFocus: false });
  const [form, setForm] = useState<FormState>(INITIAL);
  const [showMore, setShowMore] = useState(false);
  // What is actually queried: a preset id, or the custom filters as of the last "Run".
  const [source, setSource] = useState<{ kind: "preset"; id: string } | { kind: "custom"; form: FormState } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ by: string; asc: boolean }>({ by: "market_cap", asc: false });

  const groups = useMemo(() => {
    const map = new Map<string, ScreenerFilterMeta[]>();
    for (const f of meta?.filters ?? []) map.set(f.group, [...(map.get(f.group) ?? []), f]);
    return [...map.entries()];
  }, [meta]);
  const activeCount = Object.keys(toRanges(form.ranges)).length + (form.sector ? 1 : 0);

  const key = source && JSON.stringify({ source, page, pageSize, sort: source.kind === "custom" ? sort : null });
  const { data, error, isLoading, isValidating } = useSWR<ScreenerResult>(
    key,
    () => {
      if (!source) throw new Error("no query");
      if (source.kind === "preset") return fetcher<ScreenerResult>(paths.preset(source.id, pageSize, page * pageSize));
      return api.screen({
        region: source.form.region,
        sector: source.form.sector || null,
        exclude_otc: source.form.excludeOtc,
        ranges: toRanges(source.form.ranges),
        sort_by: sort.by,
        sort_asc: sort.asc,
        limit: pageSize,
        offset: page * pageSize,
      });
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const setRange = (k: string, v: { min: string; max: string }) => setForm((f) => ({ ...f, ranges: { ...f.ranges, [k]: v } }));
  const run = (e?: React.FormEvent) => {
    e?.preventDefault();
    setSource({ kind: "custom", form });
    setPage(0);
  };
  const runPreset = (id: string) => {
    setSource({ kind: "preset", id });
    setPage(0);
  };
  const sortBy = (by: string) => {
    setSort((s) => ({ by, asc: s.by === by ? !s.asc : false }));
    setPage(0);
  };

  const pages = data ? Math.ceil(Math.min(data.total, 10_000) / pageSize) : 0;
  const canSort = source?.kind === "custom";
  const from = data ? data.offset + 1 : 0;
  const to = data ? data.offset + data.results.length : 0;

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
              source?.kind === "preset" && source.id === p.id ? "border-sky-500 bg-sky-500/10 text-sky-300" : "border-slate-700 text-slate-400 hover:text-slate-200",
            )}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card title="Filters" actions={activeCount > 0 && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">{activeCount} active</span>}>
          <form onSubmit={run} className="flex flex-col gap-3">
            <Field label="Region">
              <Select value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}>
                {REGIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sector">
              <Select value={form.sector} onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))}>
                <option value="">All sectors</option>
                {meta?.sectors.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            {form.region === "us" && (
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input type="checkbox" checked={form.excludeOtc} onChange={(e) => setForm((f) => ({ ...f, excludeOtc: e.target.checked }))} className="accent-sky-500" />
                <Term term="otc">Exclude OTC / pink sheets</Term>
              </label>
            )}

            {groups
              .filter(([group]) => showMore || group === "Valuation")
              .map(([group, filters]) => (
                <fieldset key={group} className="flex flex-col gap-1.5 border-t border-slate-800 pt-3">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</legend>
                  {(showMore ? filters : filters.slice(0, 3)).map((f) => (
                    <RangeInputs key={f.key} meta={f} value={form.ranges[f.key]} onChange={(v) => setRange(f.key, v)} />
                  ))}
                </fieldset>
              ))}
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowMore((s) => !s)} aria-expanded={showMore}>
              {showMore ? "Fewer filters ▴" : `More filters (${(meta?.filters.length ?? 0) - 3}) ▾`}
            </Button>

            <Field label="Sort by">
              <Select value={sort.by} onChange={(e) => sortBy(e.target.value)}>
                {COLUMNS.filter((c) => c.sort).map((c) => (
                  <option key={c.sort} value={c.sort}>
                    {c.label}
                  </option>
                ))}
                {Object.entries(EXTRA_SORTS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" disabled={isLoading}>
                Run screen
              </Button>
              <Button type="button" variant="ghost" onClick={() => setForm(INITIAL)}>
                Reset
              </Button>
            </div>
          </form>
        </Card>

        <Card
          className="min-w-0"
          title={data ? `${data.total.toLocaleString()} matches` : "Results"}
          actions={
            data && (
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="tabular">
                  {from.toLocaleString()}–{to.toLocaleString()} of {data.total.toLocaleString()}
                </span>
                <label className="flex items-center gap-1">
                  Per page
                  <Select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(0);
                    }}
                    className="py-0.5 text-xs"
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </Select>
                </label>
              </div>
            )
          }
        >
          <ErrorBox error={error} />
          {isLoading && !data && <Spinner />}
          {!source && <Empty>Pick a preset above or run a custom screen.</Empty>}
          {data && data.results.length === 0 && <Empty>No stocks match these filters.</Empty>}
          {data && data.results.length > 0 && (
            <div className={cx("flex flex-col gap-3 transition", isValidating && "opacity-60")}>
              <div className="overflow-x-auto">
                <table className="tabular w-full text-sm">
                  <thead>
                    <tr className="text-right text-xs uppercase tracking-wide text-slate-500">
                      <th className="pb-2 text-left font-medium">Symbol</th>
                      <th className="pb-2 text-left font-medium">Name</th>
                      {COLUMNS.map((c) => {
                        const sortable = canSort && c.sort;
                        const active = sortable && sort.by === c.sort;
                        return (
                          <th key={c.label} className="whitespace-nowrap pb-2 font-medium" aria-sort={active ? (sort.asc ? "ascending" : "descending") : undefined}>
                            <span className="inline-flex items-center justify-end gap-0.5">
                              {sortable ? (
                                <button onClick={() => sortBy(c.sort!)} className={cx("uppercase hover:text-slate-200", active && "text-sky-300")} title={`Sort by ${c.label}`}>
                                  {c.label}
                                  {active ? (sort.asc ? " ↑" : " ↓") : ""}
                                </button>
                              ) : (
                                c.label
                              )}
                              {c.term && <Term term={c.term}>{null}</Term>}
                            </span>
                          </th>
                        );
                      })}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map((r) => (
                      <tr key={r.symbol} className="border-t border-slate-800 text-right hover:bg-slate-800/40">
                        <td className="py-2 text-left font-mono">
                          <Link href={`/stocks?ticker=${encodeURIComponent(r.symbol)}`} className="text-white hover:text-sky-300">
                            {r.symbol}
                          </Link>
                        </td>
                        <td className="max-w-56 truncate text-left text-slate-300" title={[r.name, r.exchange].filter(Boolean).join(" · ")}>
                          {r.name}
                        </td>
                        {COLUMNS.map((c) => (
                          <td key={c.label} className={c.className?.(r)}>
                            {c.render(r)}
                          </td>
                        ))}
                        <td className="whitespace-nowrap pl-3 text-xs">
                          <Link href={`/compare?tickers=${encodeURIComponent(r.symbol)}`} className="text-sky-400 hover:underline">
                            Compare
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500">
                  Page {page + 1} of {pages.toLocaleString()}
                  {!canSort && " · presets use Yahoo's own ordering"}
                </span>
                <Pager page={page} pages={pages} onPage={setPage} />
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
