export interface Holding {
  id: number;
  ticker: string;
  weight: number;
  /** Shares held, when the holding is a position built from the portfolio's trades. */
  quantity: number | null;
}

export interface HoldingInput {
  ticker: string;
  weight: number;
}

export interface Portfolio {
  id: number;
  name: string;
  description: string | null;
  benchmark: string;
  created_at: string;
  updated_at: string;
  holdings: Holding[];
  total_weight: number;
  /** Date of the prices the weights were derived from (position-tracked portfolios only). */
  weights_as_of: string | null;
  transaction_count: number;
}

export interface TransactionInput {
  date: string;
  kind: "buy" | "sell";
  /** B3 code (PETR4, MGLU3F) or any Yahoo symbol. */
  ticker: string;
  quantity: number;
  /** Unit price; the API uses that day's close when null. */
  price: number | null;
  institution?: string;
}

export interface Transaction {
  id: number;
  date: string;
  ticker: string;
  kind: "buy" | "sell";
  quantity: number;
  price: number | null;
  amount: number | null;
  movement: string;
  institution: string | null;
}

/** One page of a portfolio's trades, newest first. */
export interface TransactionPage {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

export interface ImportSummary {
  rows: number;
  transactions: number;
  start: string;
  end: string;
  tickers: string[];
  skipped: Record<string, number>;
  unpriced: string[];
  warnings: string[];
}

export interface ImportResult {
  portfolio: Portfolio;
  summary: ImportSummary;
}

export interface Position {
  ticker: string;
  quantity: number;
  price: number;
  value: number;
  weight: number;
  avg_price: number | null;
  cost: number | null;
  unrealized: number | null;
}

export interface Evolution {
  start: string;
  end: string;
  tickers: string[];
  points: { date: string; value: number; invested: number; weights: Record<string, number> }[];
  positions: Position[];
  totals: { value: number; invested: number; cost: number };
  unpriced: string[];
  warnings: string[];
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
  benchmark_error: string | null;
  assets: (Stats & { ticker: string; weight: number; risk_contribution: number | null })[];
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
  scores: Scores;
}

export type Signal = "bullish" | "neutral" | "bearish" | "n/a";

export interface IndicatorScore {
  key: string;
  id: string;
  label: string;
  score: number | null;
  signal: Signal;
  summary: string;
  /** Decisions taken in the indicator's decision tree, in order. */
  path: string[];
  weight: number;
  /** Fundamental factors only: growth, quality or valuation. */
  group?: string;
}

export interface ScoreSummary {
  score: number | null;
  signal: Signal;
  count: number;
}

export interface Scores {
  as_of: string;
  summary: ScoreSummary;
  indicators: IndicatorScore[];
}

export type FactorGroup = "growth" | "quality" | "valuation";

export interface FundamentalScores extends Scores {
  ticker: string;
  /** End of the latest fiscal year in the annual statements. */
  fiscal_year_end: string | null;
  groups: ({ id: FactorGroup; label: string } & ScoreSummary)[];
  indicators: (IndicatorScore & { group: FactorGroup })[];
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
  avg_volume: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  price_to_book: number | null;
  eps_ttm: number | null;
  dividend_yield: number | null;
  fifty_two_week_change_percent: number | null;
  /** Fraction, e.g. -0.05 = 5% below the 200-day average. */
  vs_200d_percent: number | null;
  analyst_rating: string | null;
}

export interface ScreenerResult {
  total: number;
  offset: number;
  limit: number;
  results: ScreenerRow[];
}

export interface ScreenerFilterMeta {
  key: string;
  label: string;
  group: string;
  unit: string;
}

export interface ScreenerMeta {
  presets: { id: string; name: string }[];
  sectors: string[];
  sort_fields: string[];
  filters: ScreenerFilterMeta[];
}

export interface ScreenerFilters {
  region: string;
  sector?: string | null;
  exclude_otc: boolean;
  ranges: Record<string, { min?: number | null; max?: number | null }>;
  sort_by: string;
  sort_asc: boolean;
  limit: number;
  offset: number;
}

export type Linkage = "single" | "complete" | "average" | "ward";

export interface HrpResult {
  period: string;
  linkage: Linkage;
  risk_free_rate: number;
  current: Stats;
  hrp: Stats;
  /** Ordered as the dendrogram leaves (HRP's quasi-diagonal order). */
  weights: { ticker: string; current: number; hrp: number | null }[];
  correlation: { tickers: string[]; matrix: (number | null)[][] };
  /** Links of the cluster tree: x in leaf-index units, y = merge distance. */
  dendrogram: { x: number[]; y: (number | null)[] }[];
}

export interface Tearsheet {
  period: string;
  window: number;
  benchmark: string | null;
  benchmark_error: string | null;
  risk_free_rate: number;
  rolling: {
    date: string;
    volatility: number | null;
    sharpe: number | null;
    beta?: number | null;
    benchmark_volatility?: number | null;
    benchmark_sharpe?: number | null;
  }[];
  underwater: { date: string; drawdown: number | null }[];
  drawdowns: { net_drawdown: number | null; peak: string | null; valley: string | null; recovery: string | null; duration_days: number | null }[];
  monthly_returns: { year: number; month: number; return: number | null }[];
}

export interface ModelParam {
  name: string;
  value: number | null;
  p_value: number | null;
}

export interface ArimaResult {
  ticker: string;
  period: string;
  horizon: number;
  as_of: string;
  last_price: number;
  order: [number, number, number];
  auto: boolean;
  aic: number | null;
  bic: number | null;
  candidates: { order: [number, number, number]; aic: number | null }[];
  /** ADF p-values for the log price and the daily log returns; d is the differencing applied to the returns. */
  adf: { price_p_value: number | null; returns_p_value: number | null; d: number };
  ljung_box_p_value: number | null;
  residual_std: number | null;
  params: ModelParam[];
  expected_return: number | null;
  /** Average simple daily return over the fitting period. */
  mean_daily_return: number | null;
  history: { date: string; close: number | null }[];
  /** `mean` is the median price path: the forecast returns compounded onto the last close. */
  forecast: { date: string; daily_return: number | null; cumulative_return: number | null; mean: number | null; lower80: number | null; upper80: number | null; lower95: number | null; upper95: number | null }[];
  backtest: {
    origins: number;
    horizon: number;
    arima: { mape: number | null; rmse: number | null; hit_rate: number | null };
    naive: { mape: number | null; rmse: number | null };
  } | null;
}

export type GarchDist = "normal" | "t" | "skewt";

export interface GarchResult {
  ticker: string;
  period: string;
  horizon: number;
  dist: GarchDist;
  as_of: string;
  params: ModelParam[];
  persistence: number | null;
  half_life_days: number | null;
  unconditional_vol_annual: number | null;
  current_vol_annual: number | null;
  realized_vol_annual: number | null;
  var95_1d: number | null;
  aic: number | null;
  conditional_vol: { date: string; vol: number | null }[];
  forecast: { date: string; vol_daily: number | null; vol_annual: number | null }[];
}

export interface CompareStats extends Stats {
  beta?: number | null;
  correlation?: number | null;
  r_squared?: number | null;
  alpha?: number | null;
  tracking_error?: number | null;
}

export interface CompareStock {
  ticker: string;
  stats: CompareStats;
  trailing_returns: Record<string, number | null>;
  profile: Partial<Profile> & {
    forward_eps?: number | null;
    revenue_ttm?: number | null;
    gross_profit_ttm?: number | null;
    ebitda_ttm?: number | null;
    gross_margin?: number | null;
    ebitda_margin?: number | null;
    operating_margin?: number | null;
    profit_margin?: number | null;
    revenue_growth?: number | null;
    earnings_growth?: number | null;
  };
  fundamentals: { currency: string | null; periods: FundamentalPeriod[] } | null;
  technical: { score: number | null; signal: Signal; count: number; indicators: { label: string; score: number | null; signal: Signal }[] } | null;
  fundamental_score: (ScoreSummary & { groups: FundamentalScores["groups"] }) | null;
}

/** Rows keyed by ticker symbol (symbols may contain "." or "^", so chart with accessor functions). */
export type TickerRow = { date: string } & Record<string, number | string | null>;

export interface CompareResult {
  tickers: string[];
  benchmark: string | null;
  benchmark_error: string | null;
  benchmark_stats: Stats | null;
  period: string;
  start: string;
  end: string;
  observations: number;
  risk_free_rate: number;
  window: number;
  stocks: CompareStock[];
  correlation: { tickers: string[]; matrix: (number | null)[][] };
  growth: TickerRow[];
  drawdown: TickerRow[];
  pairs: { key: string; a: string; b: string }[];
  rolling_correlation: TickerRow[];
  relative: { date: string; value: number | null }[] | null;
}

// --- Backtests ---------------------------------------------------------------

export type BacktestKind = "stock" | "portfolio";

export interface StrategyParam {
  name: string;
  label: string;
  default: number | string;
  type: "int" | "float" | "choice";
  min: number | null;
  max: number | null;
  step: number | null;
  options: string[] | null;
}

export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  kind: BacktestKind;
  params: StrategyParam[];
}

export type BacktestTarget = { type: "stock"; ticker: string } | { type: "portfolio"; portfolio_id: number };

export interface BacktestRequest {
  target: BacktestTarget;
  strategy: { id: string; params: Record<string, number | string> };
  period: string;
  benchmark?: string | null;
  commission_bps: number;
  slippage_bps: number;
  risk_free_rate?: number | null;
  save?: boolean;
}

export interface BacktestStats {
  total_return: number | null;
  annual_return: number | null;
  annual_volatility: number | null;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  max_drawdown: number | null;
}

export interface StrategyStats extends BacktestStats {
  trades: number;
  win_rate: number | null;
  exposure: number | null;
  turnover: number | null;
  costs: number | null;
}

export interface BacktestConfig {
  period: string;
  benchmark: string | null;
  commission_bps: number;
  slippage_bps: number;
  risk_free_rate: number | null;
}

export interface BacktestTrade {
  entry_date: string;
  entry_price: number | null;
  exit_date: string | null;
  exit_price: number | null;
  return: number | null;
  bars_held: number;
  open: boolean;
}

export interface BacktestRebalance {
  date: string;
  turnover: number | null;
  cost: number | null;
  weights: Record<string, number | null>;
}

export interface BacktestCurvePoint {
  date: string;
  strategy: number | null;
  buy_hold: number | null;
  benchmark?: number | null;
}

export interface BacktestResult {
  id: number | null;
  created_at: string | null;
  target: { type: BacktestKind; ticker?: string; portfolio_id?: number; name?: string };
  strategy: { id: string; name: string; params: Record<string, number | string> };
  config: BacktestConfig;
  start: string;
  end: string;
  observations: number;
  risk_free_rate: number;
  benchmark: string | null;
  benchmark_error: string | null;
  stats: { strategy: StrategyStats; buy_hold: BacktestStats; benchmark: (BacktestStats & { ticker: string }) | null };
  equity: BacktestCurvePoint[];
  drawdown: BacktestCurvePoint[];
  monthly_returns: { year: number; month: number; return: number | null }[];
  trades?: BacktestTrade[];
  tickers?: string[];
  rebalances?: BacktestRebalance[];
}

export interface BacktestRun {
  id: number;
  created_at: string;
  target_type: BacktestKind;
  ticker: string | null;
  portfolio_id: number | null;
  strategy_id: string;
  params: Record<string, number | string>;
  config: BacktestConfig;
  summary: { start: string; end: string; stats: BacktestResult["stats"] };
}
