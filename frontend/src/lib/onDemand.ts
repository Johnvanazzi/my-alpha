"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig, type ScopedMutator } from "swr";
import { fetcher } from "./api";

/** Keys fetched through useOnDemand, so invalidation can clear them instead of re-running them in the background. */
const onDemandKeys = new Set<string>();

/**
 * SWR for heavy calculations (model fits, optimisations) that only run when asked.
 *
 * Nothing is fetched until `run()`. The result stays tied to the inputs it was run
 * with: when `key` changes, `stale` says the shown result no longer matches them.
 * Inputs already computed (e.g. before switching tabs) show again without re-running.
 */
export function useOnDemand<T>(key: string | null) {
  const { cache } = useSWRConfig();
  const cached = (k: string | null) => k != null && cache.get(k)?.data !== undefined;
  const [ran, setRan] = useState<string | null>(() => (cached(key) ? key : null));

  useEffect(() => {
    if (key !== ran && cached(key)) setRan(key);
  }, [key]);

  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(ran, fetcher, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    keepPreviousData: true,
  });

  /** Run for `target` (the current inputs by default); running the shown inputs again recomputes them. */
  const run = (target: string | null = key) => {
    if (target == null) return;
    onDemandKeys.add(target);
    if (target === ran) mutate();
    else setRan(target);
  };

  return { data, error, isLoading, isValidating, run, ran: ran != null, stale: ran != null && ran !== key };
}

/**
 * After a portfolio's holdings or trades change: refresh its regular views and drop its
 * on-demand results, which recompute when next shown and run (or right away if on screen).
 */
export function invalidatePortfolio(mutate: ScopedMutator, portfolioId: number | string) {
  const prefix = `/portfolios/${portfolioId}/`;
  const ours = (key: unknown): key is string => typeof key === "string" && key.startsWith(prefix);
  mutate((key) => ours(key) && !onDemandKeys.has(key));
  mutate((key) => ours(key) && onDemandKeys.has(key), undefined);
}
