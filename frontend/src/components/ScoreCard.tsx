"use client";

import { type ReactNode, useState } from "react";
import { type GlossaryKey, INDICATOR_TERM } from "@/lib/glossary";
import type { ScoreSummary, Scores, Signal } from "@/lib/types";
import { InfoTip } from "./InfoTip";
import { Card, cx } from "./ui";

const SIGNAL_STYLE: Record<Signal, string> = {
  bullish: "bg-emerald-500/15 text-emerald-300 border-emerald-700",
  neutral: "bg-slate-500/15 text-slate-300 border-slate-600",
  bearish: "bg-rose-500/15 text-rose-300 border-rose-800",
  "n/a": "bg-slate-800 text-slate-500 border-slate-700",
};

export function scoreColor(score: number | null | undefined) {
  if (score == null) return "text-slate-500";
  if (score >= 6.5) return "text-emerald-400";
  if (score <= 3.5) return "text-rose-400";
  return "text-amber-300";
}

function SignalBadge({ signal, scale }: { signal: Signal; scale: [string, string, string] }) {
  const name = { bearish: scale[0], neutral: scale[1], bullish: scale[2], "n/a": "n/a" }[signal];
  return <span className={cx("rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", SIGNAL_STYLE[signal])}>{name}</span>;
}

/** 0-10 track from red to green with a marker at the score. */
function Gauge({ score, thin }: { score: number | null; thin?: boolean }) {
  return (
    <div className={cx("relative w-full rounded-full bg-gradient-to-r from-rose-500/70 via-amber-400/70 to-emerald-500/70", thin ? "h-1" : "h-2")}>
      {score != null && (
        <span
          className={cx("absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 bg-white", thin ? "h-2 w-2" : "h-3.5 w-3.5")}
          style={{ left: `${(score / 10) * 100}%` }}
        />
      )}
    </div>
  );
}

type ScoreGroup = { id: string; label: string } & ScoreSummary;

/**
 * Summary score with a gauge and an expandable decision path per item. Used for the technical score (one item
 * per indicator) and the fundamental score (factors split into groups).
 */
export function ScoreCard({
  scores,
  title = "Technical score",
  term = "technicalScore",
  itemTerms = INDICATOR_TERM,
  scale = ["Bearish", "Neutral", "Bullish"],
  asOf,
  groups,
  emptyText = "Add indicators to score them.",
}: {
  scores: Scores;
  title?: string;
  term?: GlossaryKey;
  itemTerms?: Record<string, GlossaryKey>;
  scale?: [string, string, string];
  asOf?: ReactNode;
  /** When given, show each group's score and list the items under their group. */
  groups?: ScoreGroup[];
  emptyText?: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { summary } = scores;
  const sections = groups
    ? groups.map((g) => ({ group: g as ScoreGroup | null, items: scores.indicators.filter((i) => i.group === g.id) }))
    : [{ group: null, items: scores.indicators }];

  return (
    <Card term={term} title={title} actions={<span className="text-xs text-slate-500">{asOf ?? `as of ${scores.as_of}`}</span>}>
      <div className="mb-4 flex items-end gap-3">
        <span className={cx("tabular text-4xl font-bold", scoreColor(summary.score))}>{summary.score?.toFixed(1) ?? "—"}</span>
        <span className="mb-1 text-sm text-slate-500">/ 10</span>
        <span className="mb-1.5 ml-auto">
          <SignalBadge signal={summary.signal} scale={scale} />
        </span>
      </div>
      <Gauge score={summary.score} />
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-slate-600">
        {scale.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      {groups && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {groups.map((g) => (
            <div key={g.id} className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-center">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{g.label}</div>
              <div className={cx("tabular text-lg font-semibold", scoreColor(g.score))}>{g.score?.toFixed(1) ?? "—"}</div>
            </div>
          ))}
        </div>
      )}

      {scores.indicators.length === 0 ? (
        <p className="mt-4 text-xs text-slate-500">{emptyText}</p>
      ) : (
        sections.map(({ group, items }) => (
          <div key={group?.id ?? "all"}>
            {group && <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</h3>}
            <ul className={cx("flex flex-col divide-y divide-slate-800", group ? "mt-1" : "mt-4")}>
              {items.map((s) => {
                const open = expanded === s.key;
                return (
                  <li key={s.key} className="py-2">
                    <button type="button" onClick={() => setExpanded(open ? null : s.key)} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
                      <span className="w-28 shrink-0 truncate text-xs text-slate-300">{s.label}</span>
                      <span className="flex-1">
                        <Gauge score={s.score} thin />
                      </span>
                      <span className={cx("tabular w-8 text-right text-sm font-semibold", scoreColor(s.score))}>{s.score?.toFixed(1) ?? "—"}</span>
                      <span className={cx("text-xs text-slate-500 transition", open && "rotate-90")}>›</span>
                    </button>
                    {open && (
                      <div className="mt-2 rounded-md bg-slate-950 px-3 py-2 text-xs">
                        <div className="mb-1.5 flex items-center gap-2">
                          <SignalBadge signal={s.signal} scale={scale} />
                          <span className="inline-flex items-center text-slate-500">
                            Weight ×{s.weight}
                            <InfoTip text="How much this item counts in the summary (weighted average). Default 1; weights are supported by the API and will become user-configurable." />
                          </span>
                          <InfoTip term={itemTerms[s.id]} className="ml-auto" />
                        </div>
                        <p className="text-slate-300">{s.summary}</p>
                        {s.path.length > 0 && (
                          <ol className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
                            {s.path.map((step, i) => (
                              <li key={i} className="flex items-center gap-1">
                                {i > 0 && <span className="text-slate-600">→</span>}
                                <span className="rounded bg-slate-800 px-1.5 py-0.5">{step}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </Card>
  );
}
