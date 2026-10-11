"use client";

import { Suspense, useEffect, useState } from "react";
import useSWR from "swr";
import { type ActiveIndicator, IndicatorPicker, toSpec } from "@/components/IndicatorPicker";
import { PriceChart } from "@/components/PriceChart";
import { StockHeader, useTicker } from "@/components/StockHeader";
import { Card, Empty, ErrorBox, PageHeader, Segmented, Spinner } from "@/components/ui";
import { fetcher, paths } from "@/lib/api";
import { PERIODS } from "@/lib/format";
import type { ChartData, IndicatorMeta } from "@/lib/types";

const STORAGE_KEY = "my-alpha:indicators";
const DEFAULT_INDICATORS: ActiveIndicator[] = [
  { id: "sma", params: [50] },
  { id: "sma", params: [200] },
  { id: "volume", params: [20] },
  { id: "rsi", params: [14] },
  { id: "macd", params: [12, 26, 9] },
];
const INTERVALS = [
  { value: "1d", label: "Daily" },
  { value: "1wk", label: "Weekly" },
  { value: "1mo", label: "Monthly" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function TechnicalView() {
  const [ticker, setTicker] = useTicker();
  const [period, setPeriod] = useState("1y");
  const [interval, setBarInterval] = useState("1d");
  const [active, setActive] = useState<ActiveIndicator[]>(DEFAULT_INDICATORS);

  // Remember the chosen indicators per browser.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setActive(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
    } catch {}
  }, [active]);

  const { data: available } = useSWR<IndicatorMeta[]>(paths.indicators, fetcher, { revalidateOnFocus: false });
  const specs = useDebounced(active.map(toSpec), 400);
  const chart = useSWR<ChartData>(ticker ? paths.chart(ticker, period, interval, specs) : null, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  return (
    <>
      <StockHeader ticker={ticker} onTicker={setTicker} />
      {!ticker ? (
        <>
          <PageHeader title="Technical Analysis" subtitle="Price history with moving averages, Bollinger Bands, RSI, MACD and volume." />
          <Empty>Search for a ticker to load its chart.</Empty>
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card
            className="min-w-0"
            title="Price"
            actions={
              <div className="flex flex-wrap gap-2">
                <Segmented options={PERIODS} value={period} onChange={setPeriod} />
                <Segmented options={INTERVALS} value={interval} onChange={setBarInterval} />
              </div>
            }
          >
            <ErrorBox error={chart.error} />
            {!chart.data && chart.isLoading && <Spinner />}
            {chart.data && (
              <div className={chart.isValidating ? "opacity-60 transition" : "transition"}>
                <PriceChart data={chart.data} />
              </div>
            )}
          </Card>
          <Card title="Indicators">
            {available ? <IndicatorPicker available={available} active={active} onChange={setActive} /> : <Spinner />}
          </Card>
        </div>
      )}
    </>
  );
}

export default function TechnicalPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <TechnicalView />
    </Suspense>
  );
}
