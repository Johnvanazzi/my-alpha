"use client";

import { useState } from "react";
import { PALETTE } from "@/lib/format";
import type { IndicatorMeta } from "@/lib/types";
import { Button, Select } from "./ui";

export interface ActiveIndicator {
  id: string;
  params: number[];
}

/** Serialise to the backend's spec format, e.g. "macd:12,26,9". */
export const toSpec = (a: ActiveIndicator) => (a.params.length ? `${a.id}:${a.params.join(",")}` : a.id);

export function indicatorColor(index: number) {
  return PALETTE[(index + 1) % PALETTE.length];
}

interface Props {
  available: IndicatorMeta[];
  active: ActiveIndicator[];
  onChange: (active: ActiveIndicator[]) => void;
}

export function IndicatorPicker({ available, active, onChange }: Props) {
  const [choice, setChoice] = useState("");
  const byId = Object.fromEntries(available.map((i) => [i.id, i]));

  const add = () => {
    const meta = byId[choice];
    if (!meta) return;
    onChange([...active, { id: meta.id, params: meta.params.map((p) => p.default) }]);
    setChoice("");
  };

  const setParam = (index: number, paramIndex: number, value: number) =>
    onChange(active.map((a, i) => (i === index ? { ...a, params: a.params.map((p, j) => (j === paramIndex ? value : p)) } : a)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Select value={choice} onChange={(e) => setChoice(e.target.value)} className="min-w-0 flex-1">
          <option value="">Add indicator…</option>
          {["price", "volume", "rsi", "macd"].map((pane) => {
            const items = available.filter((i) => i.pane === pane);
            if (!items.length) return null;
            return (
              <optgroup key={pane} label={pane === "price" ? "Price overlays" : "Lower panes"}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </Select>
        <Button onClick={add} disabled={!choice} variant="primary">
          Add
        </Button>
      </div>
      {choice && byId[choice] && <p className="text-xs text-slate-500">{byId[choice].description}</p>}

      <ul className="flex flex-col gap-2">
        {active.map((a, i) => {
          const meta = byId[a.id];
          if (!meta) return null;
          return (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: indicatorColor(i) }} />
              <span className="text-sm font-medium text-slate-200" title={meta.description}>
                {meta.name}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                {meta.params.map((p, j) => (
                  <label key={p.name} className="flex items-center gap-1 text-xs text-slate-500" title={p.label}>
                    <span className="hidden sm:inline">{p.label}</span>
                    <input
                      type="number"
                      min={p.min}
                      max={p.max}
                      value={a.params[j]}
                      onChange={(e) => {
                        const v = Math.round(Number(e.target.value));
                        if (!isNaN(v)) setParam(i, j, Math.min(p.max, Math.max(p.min, v)));
                      }}
                      className="tabular w-12 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-right text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </label>
                ))}
                <Button size="sm" variant="ghost" onClick={() => onChange(active.filter((_, j) => j !== i))} aria-label={`Remove ${meta.name}`}>
                  ✕
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
