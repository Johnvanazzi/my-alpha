export interface Holding {
  id: number;
  ticker: string;
  weight: number;
}

export interface HoldingInput {
  ticker: string;
  weight: number;
}

export interface Portfolio {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  holdings: Holding[];
  total_weight: number;
}

export interface Stats {
  total_return: number | null;
  annual_return: number | null;
  annual_volatility: number | null;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  max_drawdown: number | null;
}

export interface Analytics {
  period: string;
  start: string;
  end: string;
  observations: number;
  risk_free_rate: number;
  weights: Record<string, number>;
  portfolio: Stats;
  benchmark: (Stats & { ticker: string; portfolio_beta: number | null }) | null;
  assets: (Stats & { ticker: string; weight: number; risk_contribution: number | null })[];
  correlation: { tickers: string[]; matrix: (number | null)[][] };
  growth: { date: string; portfolio: number | null; benchmark?: number | null }[];
}

export interface Composition {
  holdings: {
    ticker: string;
    weight: number;
    name: string | null;
    sector: string;
    industry: string | null;
    country: string;
    price: number | null;
    currency: string | null;
    market_cap: number | null;
    trailing_pe: number | null;
    beta: number | null;
  }[];
  by_sector: { name: string; weight: number }[];
  by_country: { name: string; weight: number }[];
}

export interface IndicatorParam {
  name: string;
  label: string;
  default: number;
  min: number;
  max: number;
}

export interface IndicatorMeta {
  id: string;
  name: string;
  description: string;
  pane: string;
  params: IndicatorParam[];
  outputs: string[];
}

export interface Candle {
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface IndicatorSeries {
  key: string;
  id: string;
  label: string;
  pane: string;
  params: number[];
  series: Record<string, (number | null)[]>;
}

export interface ChartData {
  ticker: string;
  period: string;
  interval: string;
  candles: Candle[];
  indicators: IndicatorSeries[];
}

export interface Profile {
  symbol: string;
  name: string | null;
  long_name: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  currency: string | null;
  exchange: string | null;
  market_cap: number | null;
  price: number | null;
  previous_close: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  trailing_eps: number | null;
  beta: number | null;
  dividend_yield: number | null;
  summary: string | null;
}

export interface MetricDef {
  key: string;
  label: string;
  kind: "currency" | "per_share" | "percent";
}

export interface FundamentalPeriod {
  period: string;
  [metric: string]: number | string | null;
}

export interface Fundamentals {
  ticker: string;
  frequency: "annual" | "quarterly";
  currency: string | null;
  profile: Partial<Profile> & { summary?: string | null };
  ttm: Record<string, number | null>;
  metrics: MetricDef[];
  periods: FundamentalPeriod[];
}

export interface SearchResult {
  symbol: string;
  name: string | null;
  exchange: string | null;
  type: string | null;
  sector: string | null;
  industry: string | null;
}

export interface ScreenerRow {
  symbol: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  price: number | null;
  change_percent: number | null;
  market_cap: number | null;
  volume: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  eps_ttm: number | null;
  dividend_yield: number | null;
  fifty_two_week_change_percent: number | null;
}

export interface ScreenerResult {
  total: number;
  results: ScreenerRow[];
}

export interface ScreenerMeta {
  presets: { id: string; name: string }[];
  sectors: string[];
  sort_fields: string[];
}

export interface ScreenerFilters {
  region: string;
  sector?: string | null;
  min_market_cap?: number | null;
  max_market_cap?: number | null;
  min_pe?: number | null;
  max_pe?: number | null;
  min_dividend_yield?: number | null;
  min_revenue_growth?: number | null;
  min_price?: number | null;
  sort_by: string;
  sort_asc: boolean;
  limit: number;
}
