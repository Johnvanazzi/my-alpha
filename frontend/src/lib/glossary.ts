/** Short explanations shown in info tooltips across the app. */
export const GLOSSARY = {
  // --- Risk & return ---
  sharpe: {
    title: "Sharpe ratio",
    text: "Average return above the risk-free rate divided by the volatility of that excess return, annualised. Higher means more return per unit of risk. Below 0 underperforms cash; above 1 is generally good.",
  },
  sortino: {
    title: "Sortino ratio",
    text: "Like Sharpe, but only penalises downside volatility (days below the risk-free rate), so upside swings don't count as risk.",
  },
  annualReturn: {
    title: "Annual return (CAGR)",
    text: "Compound annual growth rate over the selected period: the constant yearly return that would produce the same total growth.",
  },
  totalReturn: { title: "Total return", text: "Cumulative return over the whole selected period, including dividends (prices are adjusted)." },
  volatility: {
    title: "Volatility",
    text: "Annualised standard deviation of daily returns (daily std. dev. × √252). A rough measure of how much the value swings.",
  },
  maxDrawdown: { title: "Max drawdown", text: "Largest peak-to-trough fall during the period. Shows the worst loss an investor would have sat through." },
  beta: {
    title: "Beta",
    text: "Sensitivity to the benchmark. 1 moves in line with it, above 1 amplifies its moves, below 1 dampens them, negative moves against it.",
  },
  riskFree: {
    title: "Risk-free rate",
    text: "Return available without risk, used as the hurdle in Sharpe/Sortino. Defaults to the 13-week US T-bill yield (^IRX); override it for other markets (e.g. Selic/CDI for Brazil).",
  },
  excessReturn: { title: "Excess return", text: "Annual return minus the risk-free rate: what you earned for taking risk." },
  riskContribution: {
    title: "Risk contribution",
    text: "Share of the portfolio's total variance that comes from this holding, accounting for its weight, volatility and correlation with the others. Adds up to 100%.",
  },
  weight: { title: "Weight", text: "Target share of the portfolio's value. Analytics rescale weights to sum to 100% and assume daily rebalancing." },
  correlation: {
    title: "Correlation",
    text: "How daily returns move together, from −1 (opposite) to +1 (identical). Lower correlations between holdings mean better diversification.",
  },
  benchmark: {
    title: "Benchmark",
    text: "Ticker the portfolio is compared against for growth, Sharpe and beta. Any Yahoo symbol works: ETFs (SPY, QQQ, ACWI), indices (^GSPC, ^BVSP) or stocks.",
  },
  hrp: {
    title: "Hierarchical Risk Parity (HRP)",
    text: "Allocation method by López de Prado (via PyPortfolioOpt's HRPOpt). It clusters holdings by correlation, orders them so similar assets sit together, then splits capital top-down between clusters in inverse proportion to their variance. It avoids inverting the covariance matrix, so it is more stable than mean-variance optimisation.",
  },
  linkage: {
    title: "Linkage method",
    text: "How the distance between two clusters is measured when building the tree. Single (HRP's default) uses the closest pair, complete the farthest pair, average the mean of all pairs, and Ward minimises the variance within clusters.",
  },
  dendrogram: {
    title: "Dendrogram",
    text: "Tree of how holdings merge into clusters. The lower two branches join, the more correlated they are. The height is the distance √((1 − ρ)/2): 0 means identical, 0.71 uncorrelated, 1 perfectly opposite.",
  },
  clusteredCorrelation: {
    title: "Clustered correlation",
    text: "Correlation of daily returns, re-ordered by HRP's clustering (quasi-diagonalisation). Blocks of red along the diagonal are groups of holdings that move together, so they diversify each other little.",
  },
  rollingWindow: { title: "Rolling window", text: "Number of trading days each rolling statistic looks back over. pyfolio's default is 6 months (126 days)." },
  rollingVolatility: {
    title: "Rolling volatility",
    text: "Annualised volatility over a moving window, compared with the benchmark. Shows how the portfolio's risk changes over time.",
  },
  rollingBeta: {
    title: "Rolling beta",
    text: "Beta to the benchmark over a moving window. Shows whether market sensitivity is stable or drifts as conditions change. The dashed line marks beta = 1.",
  },
  rollingSharpe: {
    title: "Rolling Sharpe ratio",
    text: "Sharpe ratio (excess return ÷ volatility, annualised) over a moving window. Shows whether risk-adjusted performance is consistent or comes from a few good stretches. The dashed line is the average.",
  },
  underwater: {
    title: "Underwater plot",
    text: "How far the portfolio is below its previous peak on each day. 0% means a new high. Deep or long dips show painful drawdowns and slow recoveries.",
  },
  drawdownTable: {
    title: "Worst drawdowns",
    text: "The largest peak-to-trough declines (pyfolio's drawdown table): when each started, bottomed and recovered, and how many business days it lasted.",
  },
  monthlyReturns: {
    title: "Monthly returns",
    text: "Return of each calendar month. The distribution shows how often months are good or bad and how fat the tails are. The first and last months may be partial.",
  },
  growth: { title: "Growth of 100", text: "Value of 100 invested at the start of the period, for the portfolio and the benchmark." },

  // --- Market data ---
  marketCap: { title: "Market capitalisation", text: "Share price × shares outstanding: the market value of the whole company." },
  pe: { title: "P/E (trailing)", text: "Price divided by earnings per share over the last 12 months. How many years of current earnings the price represents." },
  forwardPe: { title: "Forward P/E", text: "Price divided by analysts' expected EPS for the next 12 months." },
  epsTtm: { title: "EPS (TTM)", text: "Net income attributable to shareholders per share over the trailing twelve months." },
  dividendYield: { title: "Dividend yield", text: "Annual dividends per share as a percentage of the share price." },
  dayChange: { title: "Day change", text: "Percentage change from the previous close." },
  week52Change: { title: "52-week change", text: "Percentage change in price over the last 52 weeks." },
  week52Range: { title: "52-week range", text: "Lowest and highest price over the last 52 weeks." },
  volume: { title: "Volume", text: "Number of shares traded in the session." },
  revenueGrowthFilter: { title: "Revenue growth", text: "Year-over-year growth of trailing-twelve-month revenue, in percent." },

  // --- Fundamentals ---
  revenue: { title: "Revenue", text: "Total sales from the company's operations before any costs are deducted (the top line)." },
  grossProfit: { title: "Gross profit", text: "Revenue minus cost of goods sold. Shows how profitable the core product is before overheads." },
  ebitda: {
    title: "EBITDA",
    text: "Earnings before interest, taxes, depreciation and amortisation. A proxy for operating cash generation that ignores capital structure and accounting for past investment.",
  },
  operatingIncome: { title: "Operating income", text: "Profit from operations after operating expenses, before interest and taxes (EBIT)." },
  netIncome: { title: "Net income", text: "Profit after all expenses, interest and taxes (the bottom line)." },
  epsBasic: { title: "Basic EPS", text: "Net income available to common shareholders divided by the weighted average shares outstanding." },
  epsDiluted: {
    title: "Diluted EPS",
    text: "EPS assuming all convertible securities, options and warrants were exercised. Usually slightly below basic EPS and the more conservative figure.",
  },
  grossMargin: { title: "Gross margin", text: "Gross profit ÷ revenue. Pricing power and production efficiency." },
  ebitdaMargin: { title: "EBITDA margin", text: "EBITDA ÷ revenue. Operating profitability before D&A, interest and taxes." },
  netMargin: { title: "Net margin", text: "Net income ÷ revenue. How much of each sale ends up as profit." },
  revenueGrowth: { title: "Revenue growth", text: "Change versus the previous period shown (year over year for annual, quarter over quarter for quarterly)." },
  epsGrowth: { title: "EPS growth", text: "Change in diluted EPS versus the previous period shown." },
  ttm: { title: "TTM", text: "Trailing twelve months: the sum of the last four reported quarters." },

  // --- Technical indicators ---
  sma: {
    title: "Simple Moving Average",
    text: "Average closing price of the last N bars. Price above a rising SMA suggests an uptrend; common periods are 20, 50 and 200.",
  },
  ema: {
    title: "Exponential Moving Average",
    text: "Moving average that gives more weight to recent prices, so it reacts faster than an SMA of the same period.",
  },
  bbands: {
    title: "Bollinger Bands",
    text: "A moving average with bands N standard deviations above and below. Touching the bands shows stretched prices; narrowing bands (a squeeze) often precede big moves.",
  },
  rsi: {
    title: "Relative Strength Index",
    text: "Momentum oscillator from 0 to 100 comparing recent gains to losses. Above 70 is traditionally overbought, below 30 oversold; 50 splits bullish and bearish momentum.",
  },
  macd: {
    title: "MACD",
    text: "Fast EMA minus slow EMA (MACD line), its EMA (signal line) and their difference (histogram). Crossovers of the signal line and of zero mark momentum and trend changes.",
  },
  volumeIndicator: {
    title: "Volume",
    text: "Shares traded per bar with its moving average. Moves on above-average volume carry more conviction than moves on light volume.",
  },
  arima: {
    title: "ARIMA",
    text: "AutoRegressive Integrated Moving Average, fitted on daily log returns rather than prices (returns are stationary, prices are not). It predicts each day's return from past returns (AR, order p) and past forecast errors (MA, order q); the constant is the average daily return. The forecast returns are compounded onto the last close to get the price path. Returns are close to unpredictable, so expect wide bands and a small edge at best.",
  },
  arimaOrder: {
    title: "Order (p, d, q)",
    text: "p = autoregressive lags, d = times the returns are differenced (0 almost always: returns are already the price differenced once), q = moving-average lags. In auto mode, d comes from the ADF test on returns and (p, q) is the combination with the lowest AIC among 0-2 each.",
  },
  aic: { title: "AIC", text: "Akaike Information Criterion: goodness of fit penalised by the number of parameters. Lower is better; only comparable between models fitted on the same data." },
  adf: {
    title: "ADF test",
    text: "Augmented Dickey-Fuller test for a unit root. A p-value below 0.05 means the series is stationary. Log prices usually aren't (p ≫ 0.05) but daily returns are, which is why the model is fitted on returns with d = 0.",
  },
  ljungBox: {
    title: "Ljung-Box test",
    text: "Checks whether residuals still have autocorrelation. A p-value above 0.05 means no significant pattern is left, which is what you want. Below 0.05, the model is missing structure.",
  },
  forecastBands: {
    title: "Forecast bands",
    text: "Ranges the price should stay within with 80% and 95% probability if the model is right, from the distribution of the cumulative log return (so the bands are lognormal: wider above than below). They widen with the horizon because uncertainty compounds. The central line is the median path. They assume constant volatility; see GARCH for how volatility itself changes.",
  },
  expectedReturn: { title: "Expected move", text: "Compounded forecast return from the last close to the end of the horizon (median price path)." },
  backtest: {
    title: "Backtest",
    text: "Out-of-sample check: the model is fitted on older data, then forecasts the horizon from several past dates using only information available at that time. It is compared with a naive random walk that predicts no change. If ARIMA can't beat it, it has no real edge.",
  },
  mape: { title: "MAPE", text: "Mean absolute percentage error of the forecast at the end of the horizon. Lower is better." },
  rmse: { title: "RMSE", text: "Root mean squared error in price units. Penalises large misses more than MAPE." },
  hitRate: { title: "Direction hit rate", text: "Share of backtest forecasts that got the direction (up or down) right. 50% is a coin flip." },
  coefficients: { title: "Coefficients", text: "Estimated model parameters. A p-value below 0.05 means the coefficient is statistically different from zero." },
  garch: {
    title: "GARCH(1,1)",
    text: "Generalised AutoRegressive Conditional Heteroskedasticity. It models today's variance as a long-run level (ω) plus a reaction to yesterday's shock (α) and the persistence of yesterday's variance (β). It captures volatility clustering: calm and turbulent periods tend to persist.",
  },
  garchDist: {
    title: "Innovation distribution",
    text: "Distribution of standardised shocks. Student's t has fatter tails than the normal and usually fits returns better; skewed t also allows asymmetry between up and down moves.",
  },
  persistence: {
    title: "Persistence (α + β)",
    text: "How long volatility shocks last. Close to 1 means shocks fade slowly; at 1 or above the variance doesn't revert to a long-run level.",
  },
  halfLife: { title: "Half-life", text: "Trading days for a volatility shock to decay halfway back to its long-run level: ln(0.5) / ln(α + β)." },
  longRunVol: { title: "Long-run volatility", text: "Unconditional volatility the model reverts to: √(ω / (1 − α − β)), annualised." },
  conditionalVol: { title: "Conditional volatility", text: "The model's estimate of current volatility given recent returns, annualised. The forecast shows it reverting towards the long-run level." },
  realizedVol: { title: "Realised volatility (1M)", text: "Standard deviation of the last 21 daily returns, annualised. A model-free comparison for the GARCH estimate." },
  var95: {
    title: "1-day VaR (95%)",
    text: "Value at Risk: the daily loss that should be exceeded only 1 day in 20, from tomorrow's GARCH volatility forecast and the fitted distribution.",
  },
  obv: {
    title: "On-Balance Volume (OBV)",
    text: "Running total of volume: a day's volume is added when the close is up and subtracted when it's down. Its level is arbitrary; what matters is its direction against price. OBV rising with price confirms the trend; price rising while OBV falls (a divergence) warns the move lacks volume behind it. The orange line is an EMA of OBV used as a signal line.",
  },
  vs200d: { title: "vs 200-day average", text: "How far the price is above or below its 200-day moving average. A common long-term trend gauge." },
  priceToBook: { title: "Price/Book", text: "Share price divided by book value (equity) per share. Below 1 means the market values the company below its accounting equity; negative means negative equity." },
  avgVolume: { title: "Average volume (3M)", text: "Average shares traded per day over the last three months. Higher means more liquid and easier to trade without moving the price." },
  analystRating: { title: "Analyst rating", text: "Yahoo's average analyst recommendation from 1 (strong buy) to 5 (sell)." },
  otc: { title: "OTC / pink sheets", text: "Over-the-counter listings (often foreign ADRs or small, thinly traded companies) with lighter reporting rules. Excluding them keeps NYSE, Nasdaq and NYSE American listings." },
  alpha: {
    title: "Alpha (Jensen's)",
    text: "Annualised return above what the stock's beta to the benchmark would predict, after the risk-free rate. Positive alpha means it outperformed for the market risk it took over this period.",
  },
  rSquared: { title: "R²", text: "Share of the stock's daily return variance explained by the benchmark (correlation squared). Low R² means beta and alpha say little about this stock." },
  trackingError: { title: "Tracking error", text: "Annualised volatility of the difference between the stock's and the benchmark's returns: how far it strays from the benchmark." },
  benchmarkCorrelation: { title: "Correlation with benchmark", text: "Correlation of daily returns with the benchmark, from −1 to +1." },
  trailingReturns: { title: "Trailing returns", text: "Total price return (dividends included, prices are adjusted) over each lookback ending at the latest close, independent of the selected period. 3Y and 5Y are cumulative, not annualised." },
  relativeStrength: {
    title: "Relative strength",
    text: "First stock's growth divided by the second's, starting at 100. A rising line means the first is outperforming; falling means the second is.",
  },
  rollingCorrelation: { title: "Rolling correlation", text: "Correlation of daily returns over a moving 3-month window. Shows whether the relationship is stable or changes with market conditions." },
  technicalScore: {
    title: "Technical score",
    text: "Each indicator is scored 0 (strongly bearish) to 10 (strongly bullish) through a decision tree on the latest bar; 5 is neutral. The summary is the weighted average of the scores. This is a mechanical reading of the indicators, not investment advice.",
  },
  fundamentalScore: {
    title: "Fundamental score",
    text: "Eight factors scored 0 (weak or expensive) to 10 (strong or cheap) by decision trees on Yahoo's TTM figures and annual statements, grouped into growth, quality and valuation; 5 is neutral. The summary is the weighted average. Thresholds are rules of thumb that don't adjust for sector, except that cash-flow and leverage checks are skipped for banks and insurers. Not investment advice.",
  },
  factorRevenueGrowth: {
    title: "Revenue growth",
    text: "Latest year-over-year revenue growth compared with the 3-year compound annual growth rate (CAGR), to tell sustained growth from acceleration or slowdown.",
  },
  factorEarningsGrowth: {
    title: "Earnings growth",
    text: "3-year CAGR of diluted EPS plus the change analysts expect (forward EPS vs trailing EPS). Losses score low unless a profit is expected.",
  },
  roe: {
    title: "Return on equity (ROE)",
    text: "Net income ÷ shareholders' equity. Checked against return on assets (ROA), because debt can inflate ROE; ~1% ROA is healthy for banks, ~7% for other companies. Negative equity (often from buybacks) is judged on ROA.",
  },
  factorMargins: {
    title: "Margins",
    text: "Operating margin (net margin for banks) over the last 12 months, and whether it is expanding or contracting by more than 1 pp against the 3-year average.",
  },
  freeCashFlow: {
    title: "Free cash flow",
    text: "Operating cash flow minus capital expenditure over the last four quarters. Conversion (FCF ÷ net income) shows whether profits turn into cash; negative FCF in more than one of the last four fiscal years counts as unreliable.",
  },
  balanceSheet: {
    title: "Balance sheet",
    text: "Net debt (debt minus cash) ÷ EBITDA: years of operating profit needed to repay debt. Below 1× is low, above 4× is high. A current ratio below 1 (short-term liabilities above current assets) lowers the score.",
  },
  factorValuation: {
    title: "Valuation multiples",
    text: "P/E (forward if there are no trailing earnings) with PEG to adjust for growth: under 10 is cheap, 15-25 fair, over 40 very expensive. A low P/E with a higher forward P/E (earnings expected to fall) is flagged as a possible value trap. Companies without earnings are judged on EV/Sales.",
  },
  peHistory: {
    title: "P/E vs own history",
    text: "Current P/E divided by the median P/E at past fiscal year ends (year-end price ÷ annual EPS). Well above 1 means the price has run ahead of earnings (stretched / overbought on fundamentals); well below 1 means cheaper than usual.",
  },
  // --- Backtests ---
  strategyBacktest: {
    title: "Backtest",
    text: "Replays a trading or allocation rule on past prices to see how it would have done. Signals use only data available at the time, but past results don't guarantee future ones, and a rule tuned until it looks good on one history usually disappoints on the next.",
  },
  buyHold: {
    title: "Buy and hold",
    text: "Buying on the first day and holding to the end, with no costs. For a portfolio, the saved weights are bought once and left to drift. The baseline a strategy must beat to be worth its trading.",
  },
  winRate: {
    title: "Win rate",
    text: "Share of trades that made money after costs (an open trade is marked to the last close). For portfolio strategies: share of the periods between rebalances with a positive return. A low win rate can still be profitable if winners are much larger than losers.",
  },
  tradeCount: {
    title: "Trades",
    text: "Number of round trips (entries) for a stock strategy; number of rebalances, including the initial purchase, for a portfolio strategy.",
  },
  exposure: {
    title: "Exposure",
    text: "Average share of the capital invested. A stock strategy with 50% exposure sits in cash half the time (earning nothing in this backtest), so compare its return with that in mind.",
  },
  turnover: {
    title: "Turnover",
    text: "Value traded per year as a multiple of the portfolio's value, counting buys and sells. 2.0× is like selling and rebuying everything once a year. Higher turnover means higher costs and, in real life, taxes.",
  },
  tradingCosts: {
    title: "Cost drag",
    text: "Share of final equity lost to commissions and slippage: how much higher the ending value would be if the same trades were free.",
  },
  commission: { title: "Commission", text: "Broker fee charged on every trade, in basis points of the traded value (1 bp = 0.01%)." },
  slippage: {
    title: "Slippage",
    text: "Price lost to the bid-ask spread and market impact on every trade, in basis points of the traded value. 5-10 bps is reasonable for liquid large caps; use more for small caps.",
  },
  backtestExecution: {
    title: "Execution",
    text: "Stock strategies decide on each day's close and trade at the next day's open, so they never use information they couldn't have had. They are long or flat (no shorting or leverage). Portfolio strategies (bt) rebalance at the close of the first trading day of each period, with weights estimated from prices up to that day.",
  },
  rebalanceFrequency: { title: "Rebalance", text: "How often the portfolio is traded back to its target weights: on the first trading day of each month, quarter or year." },
  lookback: {
    title: "Lookback",
    text: "Months of trailing prices used to estimate volatilities and correlations at each rebalance. Short lookbacks react faster but are noisier.",
  },
  equityCurve: {
    title: "Equity curve",
    text: "Value of 100 invested at the start, for the strategy (after costs), buy and hold and the benchmark.",
  },
} as const satisfies Record<string, { title: string; text: string }>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** Glossary entry for a backend indicator id. */
export const INDICATOR_TERM: Record<string, GlossaryKey> = {
  sma: "sma",
  ema: "ema",
  bbands: "bbands",
  rsi: "rsi",
  macd: "macd",
  volume: "volumeIndicator",
  obv: "obv",
};

/** Glossary entry for a fundamental score factor id. */
export const FACTOR_TERM: Record<string, GlossaryKey> = {
  revenue_growth: "factorRevenueGrowth",
  earnings_growth: "factorEarningsGrowth",
  roe: "roe",
  margins: "factorMargins",
  cash_flow: "freeCashFlow",
  balance_sheet: "balanceSheet",
  valuation: "factorValuation",
  valuation_history: "peHistory",
};

/** Glossary entry for a fundamentals metric key. */
export const METRIC_TERM: Record<string, GlossaryKey> = {
  revenue: "revenue",
  gross_profit: "grossProfit",
  ebitda: "ebitda",
  operating_income: "operatingIncome",
  net_income: "netIncome",
  eps_basic: "epsBasic",
  eps_diluted: "epsDiluted",
  gross_margin: "grossMargin",
  ebitda_margin: "ebitdaMargin",
  net_margin: "netMargin",
  revenue_growth: "revenueGrowth",
  eps_growth: "epsGrowth",
};
