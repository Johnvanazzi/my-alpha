import type { BacktestRequest, BacktestResult, HoldingInput, ImportResult, Portfolio, TransactionInput, ScreenerFilters, ScreenerResult, SearchResult } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function errorMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  // FastAPI validation errors: [{loc, msg, ...}]
  if (Array.isArray(detail)) return detail.map((d) => d?.msg?.replace(/^Value error, /, "") ?? String(d)).join("; ");
  return "Request failed";
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    // Let the browser set the multipart boundary for file uploads.
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(errorMessage(body.detail) || res.statusText, res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** SWR fetcher: keys are API paths such as "/portfolios". */
export const fetcher = <T>(path: string) => request<T>(path);

const json = (body: unknown) => JSON.stringify(body);
const enc = encodeURIComponent;

export const api = {
  portfolios: () => request<Portfolio[]>("/portfolios"),
  createPortfolio: (body: { name: string; description?: string; holdings?: HoldingInput[] }) =>
    request<Portfolio>("/portfolios", { method: "POST", body: json(body) }),
  updatePortfolio: (id: number, body: { name?: string; description?: string | null; benchmark?: string }) =>
    request<Portfolio>(`/portfolios/${id}`, { method: "PATCH", body: json(body) }),
  copyPortfolio: (id: number, name?: string) =>
    request<Portfolio>(`/portfolios/${id}/copy`, { method: "POST", body: json(name ? { name } : {}) }),
  deletePortfolio: (id: number) => request<void>(`/portfolios/${id}`, { method: "DELETE" }),
  replaceHoldings: (id: number, holdings: HoldingInput[]) =>
    request<Portfolio>(`/portfolios/${id}/holdings`, { method: "PUT", body: json({ holdings }) }),
  importPortfolio: (file: File, body: { name: string; description?: string; benchmark?: string }) => {
    const form = new FormData();
    form.append("file", file);
    for (const [k, v] of Object.entries(body)) if (v) form.append(k, v);
    return request<ImportResult>("/portfolios/import", { method: "POST", body: form });
  },
  importTransactions: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ImportResult>(`/portfolios/${id}/transactions/import`, { method: "POST", body: form });
  },
  syncPositions: (id: number) => request<Portfolio>(`/portfolios/${id}/positions/sync`, { method: "POST" }),
  addTransaction: (id: number, body: TransactionInput) =>
    request<Portfolio>(`/portfolios/${id}/transactions`, { method: "POST", body: json(body) }),
  deleteTransaction: (id: number, transactionId: number) =>
    request<Portfolio>(`/portfolios/${id}/transactions/${transactionId}`, { method: "DELETE" }),

  screen: (filters: ScreenerFilters) =>
    request<ScreenerResult>("/screener", { method: "POST", body: json(filters) }),
  search: (q: string) => request<SearchResult[]>(`/market/search?q=${enc(q)}`),

  runBacktest: (body: BacktestRequest) => request<BacktestResult>("/backtests", { method: "POST", body: json(body) }),
  deleteBacktest: (id: number) => request<void>(`/backtests/${id}`, { method: "DELETE" }),
};

export const paths = {
  portfolio: (id: number | string) => `/portfolios/${id}`,
  analytics: (id: number | string, period: string, rf: number | null, benchmark: string) =>
    `/portfolios/${id}/analytics?period=${period}&benchmark=${enc(benchmark)}${rf == null ? "" : `&risk_free_rate=${rf}`}`,
  composition: (id: number | string) => `/portfolios/${id}/composition`,
  evolution: (id: number | string) => `/portfolios/${id}/evolution`,
  transactions: (id: number | string, limit: number, offset: number) => `/portfolios/${id}/transactions?limit=${limit}&offset=${offset}`,
  hrp: (id: number | string, period: string, linkage: string, rf: number | null) =>
    `/portfolios/${id}/hrp?period=${period}&linkage=${linkage}${rf == null ? "" : `&risk_free_rate=${rf}`}`,
  tearsheet: (id: number | string, period: string, window: number, rf: number | null, benchmark: string) =>
    `/portfolios/${id}/tearsheet?period=${period}&window=${window}&benchmark=${enc(benchmark)}${rf == null ? "" : `&risk_free_rate=${rf}`}`,
  indicators: "/market/indicators",
  profile: (t: string) => `/market/${enc(t)}/profile`,
  chart: (t: string, period: string, interval: string, specs: string[]) =>
    `/market/${enc(t)}/chart?period=${period}&interval=${interval}${specs.map((s) => `&indicators=${enc(s)}`).join("")}`,
  arima: (t: string, horizon: number, period: string, order: string | null) =>
    `/market/${enc(t)}/arima?horizon=${horizon}&period=${period}${order ? `&order=${order}` : ""}`,
  garch: (t: string, horizon: number, period: string, dist: string) => `/market/${enc(t)}/garch?horizon=${horizon}&period=${period}&dist=${dist}`,
  fundamentals: (t: string, frequency: string) => `/fundamentals/${enc(t)}?frequency=${frequency}`,
  fundamentalScore: (t: string) => `/fundamentals/${enc(t)}/score`,
  screenerMeta: "/screener/presets",
  preset: (id: string, limit: number, offset: number) => `/screener/presets/${id}?limit=${limit}&offset=${offset}`,
  backtestStrategies: "/backtests/strategies",
  backtests: (target: { ticker: string } | { portfolioId: number }) =>
    "ticker" in target ? `/backtests?ticker=${enc(target.ticker)}` : `/backtests?portfolio_id=${target.portfolioId}`,
  compare: (tickers: string[], period: string, benchmark: string, rf: number | null) =>
    `/compare?${tickers.map((t) => `tickers=${enc(t)}`).join("&")}&period=${period}&benchmark=${enc(benchmark)}${rf == null ? "" : `&risk_free_rate=${rf}`}`,
};

