"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { type ActiveIndicator, IndicatorPicker, toSpec } from "./IndicatorPicker";
import { PriceChart, type PriceMode } from "./PriceChart";
import { ScoreCard } from "./ScoreCard";
import { Card, ErrorBox, Segmented, Spinner } from "./ui";
import { fetcher, paths } from "@/lib/api";
import { PERIODS } from "@/lib/format";
import type { ChartData, IndicatorMeta } from "@/lib/types";

const STORAGE_KEY = "my-alpha:indicators";
const DEFAULT_INDICATORS: ActiveIndicator[] = [
  { id: "sma", params: [50] },
  { id: "sma", params: [200] },
  { id: "ema", params: [20] },
  { id: "volume", params: [20] },
  { id: "obv", params: [20] },
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

export function TechnicalSection({ ticker }: { ticker: string }) {
  const [period, setPeriod] = useState("1y");
  const [interval, setBarInterval] = useState("1d");
  const [mode, setMode] = useState<PriceMode>("candles");
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
  const chart = useSWR<ChartData>(paths.chart(ticker, period, interval, specs), fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  return (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card
            className="min-w-0"
            title="Price"
            actions={
              <div className="flex flex-wrap gap-2">
                <Segmented options={PERIODS} value={period} onChange={setPeriod} />
                <Segmented options={INTERVALS} value={interval} onChange={setBarInterval} />
                <Segmented
                  options={[
                    { value: "candles", label: "Candles" },
                    { value: "line", label: "Line" },
                  ]}
                  value={mode}
                  onChange={setMode}
                />
              </div>
            }
          >
            <ErrorBox error={chart.error} />
            {!chart.data && chart.isLoading && <Spinner />}
            {chart.data && (
              <div className={chart.isValidating ? "opacity-60 transition" : "transition"}>
                <PriceChart data={chart.data} mode={mode} />
              </div>
            )}
          </Card>
          <div className="flex flex-col gap-6">
            {chart.data && <ScoreCard scores={chart.data.scores} />}
            <Card title="Indicators">
              {available ? <IndicatorPicker available={available} active={active} onChange={setActive} /> : <Spinner />}
            </Card>
          </div>
        </div>
  );
}
