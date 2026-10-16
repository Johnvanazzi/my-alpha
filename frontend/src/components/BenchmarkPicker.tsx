"use client";

import { useEffect, useRef, useState } from "react";
import { InfoTip } from "./InfoTip";
import { TickerSearch } from "./TickerSearch";
import { cx } from "./ui";

const PRESETS = [
  { symbol: "SPY", label: "S&P 500 (SPY)" },
  { symbol: "QQQ", label: "Nasdaq 100 (QQQ)" },
  { symbol: "IWM", label: "Russell 2000 (IWM)" },
  { symbol: "ACWI", label: "All-World (ACWI)" },
  { symbol: "AGG", label: "US Bonds (AGG)" },
  { symbol: "^BVSP", label: "Ibovespa (^BVSP)" },
];

interface Props {
  value: string;
  onChange: (symbol: string) => void;
  disabled?: boolean;
}

/** Compact control showing the current benchmark, with presets and free search. */
export function BenchmarkPicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (symbol: string) => {
    onChange(symbol.toUpperCase());
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative flex items-center gap-2 text-xs text-slate-400">
      <span className="inline-flex items-center">
        Benchmark
        <InfoTip term="benchmark" />
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 font-mono text-sm text-white hover:border-slate-500 disabled:opacity-50"
      >
        {value} <span className="text-slate-500">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.symbol}
                type="button"
                onClick={() => choose(p.symbol)}
                title={p.label}
                className={cx(
                  "rounded-full border px-2.5 py-0.5 font-mono text-xs",
                  p.symbol === value ? "border-sky-500 bg-sky-500/10 text-sky-300" : "border-slate-700 text-slate-300 hover:border-slate-500",
                )}
              >
                {p.symbol}
              </button>
            ))}
          </div>
          <TickerSearch onSelect={choose} placeholder="Any ticker or index…" autoFocus />
        </div>
      )}
    </div>
  );
}
