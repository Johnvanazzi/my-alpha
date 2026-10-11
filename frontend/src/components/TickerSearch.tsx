"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SearchResult } from "@/lib/types";
import { cx } from "./ui";

interface Props {
  onSelect: (symbol: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

/** Debounced Yahoo Finance symbol search with a dropdown. Enter submits the raw text as a ticker. */
export function TickerSearch({ onSelect, placeholder = "Search ticker or company…", className, autoFocus }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .search(q)
        .then((r) => !cancelled && (setResults(r), setHighlight(0)))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const choose = (symbol: string) => {
    onSelect(symbol.toUpperCase());
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className={cx("relative", className)}>
      <input
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHighlight((h) => Math.min(h + 1, results.length - 1));
          else if (e.key === "ArrowUp") setHighlight((h) => Math.max(h - 1, 0));
          else if (e.key === "Escape") setOpen(false);
          else if (e.key === "Enter") {
            e.preventDefault();
            const pick = open && results[highlight] ? results[highlight].symbol : query.trim();
            if (pick) choose(pick);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-40 mt-1 max-h-80 w-full overflow-auto rounded-md border border-slate-700 bg-slate-900 py-1 shadow-xl">
          {results.map((r, i) => (
            <li key={r.symbol}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r.symbol)}
                onMouseEnter={() => setHighlight(i)}
                className={cx("flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm", i === highlight && "bg-slate-800")}
              >
                <span className="w-20 shrink-0 font-mono font-semibold text-white">{r.symbol}</span>
                <span className="truncate text-slate-300">{r.name}</span>
                <span className="ml-auto shrink-0 text-xs text-slate-500">
                  {[r.type, r.exchange].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
