import type { Analytics, HoldingInput, Portfolio, ScreenerFilters, ScreenerResult, SearchResult } from "./types";

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
    headers: { "Content-Type": "application/json", ...init?.headers },
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
  updatePortfolio: (id: number, body: { name?: string; description?: string | null }) =>
    request<Portfolio>(`/portfolios/${id}`, { method: "PATCH", body: json(body) }),
  deletePortfolio: (id: number) => request<void>(`/portfolios/${id}`, { method: "DELETE" }),
  replaceHoldings: (id: number, holdings: HoldingInput[]) =>
    request<Portfolio>(`/portfolios/${id}/holdings`, { method: "PUT", body: json({ holdings }) }),

  sharpe: (body: { holdings: HoldingInput[]; period: string; risk_free_rate?: number | null }) =>
    request<Analytics>("/analytics/sharpe", { method: "POST", body: json(body) }),
  screen: (filters: ScreenerFilters) =>
    request<ScreenerResult>("/screener", { method: "POST", body: json(filters) }),
  search: (q: string) => request<SearchResult[]>(`/market/search?q=${enc(q)}`),
};

export const paths = {
  portfolio: (id: number | string) => `/portfolios/${id}`,
  analytics: (id: number | string, period: string, rf: number | null) =>
    `/portfolios/${id}/analytics?period=${period}${rf == null ? "" : `&risk_free_rate=${rf}`}`,
  composition: (id: number | string) => `/portfolios/${id}/composition`,
  indicators: "/market/indicators",
  riskFree: "/market/risk-free-rate",
  profile: (t: string) => `/market/${enc(t)}/profile`,
  chart: (t: string, period: string, interval: string, specs: string[]) =>
    `/market/${enc(t)}/chart?period=${period}&interval=${interval}${specs.map((s) => `&indicators=${enc(s)}`).join("")}`,
  fundamentals: (t: string, frequency: string) => `/fundamentals/${enc(t)}?frequency=${frequency}`,
  screenerMeta: "/screener/presets",
  preset: (id: string) => `/screener/presets/${id}?limit=100`,
};

