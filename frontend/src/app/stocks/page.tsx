"use client";

import { Suspense } from "react";
import { BacktestPanel } from "@/components/BacktestPanel";
import { ForecastSection } from "@/components/ForecastSection";
import { FundamentalsSection } from "@/components/FundamentalsSection";
import { StockHeader, useTicker } from "@/components/StockHeader";
import { TechnicalSection } from "@/components/TechnicalSection";
import { Empty, PageHeader, Spinner } from "@/components/ui";

function SectionTitle({ id, title, subtitle }: { id: string; title: string; subtitle: string }) {
  return (
    <div id={id} className="mb-4 scroll-mt-28 border-b border-slate-800 pb-2">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

function StockView() {
  const [ticker, setTicker] = useTicker();

  return (
    <>
      <StockHeader ticker={ticker} onTicker={setTicker} />
      {!ticker ? (
        <>
          <PageHeader title="Stock Analysis" subtitle="Price action, technical indicators and financial reports for a single stock." />
          <Empty>Search for a ticker to load its chart and financial statements.</Empty>
        </>
      ) : (
        <div className="flex flex-col gap-10">
          <section>
            <SectionTitle id="technical" title="Technical" subtitle="Candlesticks, indicators and their 0-10 scores." />
            <TechnicalSection ticker={ticker} />
          </section>
          <section>
            <SectionTitle id="fundamentals" title="Fundamentals" subtitle="Revenue, gross profit, EBITDA and EPS from the income statement." />
            <FundamentalsSection ticker={ticker} />
          </section>
          <section>
            <SectionTitle id="forecast" title="Forecast" subtitle="ARIMA price forecast (up to 20 trading days) and GARCH volatility study." />
            <ForecastSection ticker={ticker} />
          </section>
          <section>
            <SectionTitle id="backtest" title="Backtest" subtitle="Test a trading rule on this stock's history against buy and hold and a benchmark." />
            <BacktestPanel target={{ type: "stock", ticker }} />
          </section>
        </div>
      )}
    </>
  );
}

export default function StocksPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <StockView />
    </Suspense>
  );
}
