# my-alpha

Track portfolios, screen stocks, and study price action and financial reports. Market data comes from Yahoo Finance via [yfinance](https://github.com/ranaroussi/yfinance).

| Layer    | Stack                                                     |
| -------- | --------------------------------------------------------- |
| Frontend | Next.js 16 (App Router), React 19, Tailwind 4, Recharts   |
| Backend  | Python 3.14 + uv, FastAPI, SQLAlchemy 2, pandas, yfinance |
| Database | PostgreSQL 17                                             |

## Run it

```bash
docker compose up --build
```

- App: http://localhost:3000
- API docs (Swagger): http://localhost:8000/docs

The compose stack runs in development mode. `backend/app` and `frontend` are bind-mounted, so code changes reload automatically. The browser only talks to Next.js, which proxies `/api/*` to FastAPI (see `frontend/next.config.ts`).

For a production frontend image, build the `prod` target: `docker build --target prod frontend`.

### Backend with uv

The backend is a [uv](https://docs.astral.sh/uv/) project: dependencies live in `backend/pyproject.toml`, exact versions in `backend/uv.lock`, and `backend/.python-version` pins Python 3.14. The Docker image installs the lock with `uv sync --locked`. After changing dependencies, rebuild the image (`docker compose up --build`).

```bash
cd backend
uv sync                      # create/update .venv from uv.lock (dev tools included)
uv add <package>             # add a dependency and update the lock
uv run uvicorn app.main:app --reload   # run the API outside Docker (needs Postgres, see DATABASE_URL in app/config.py)
```

## Features

- **Portfolios**: create, duplicate and edit portfolios of tickers and weights in place (scale to 100%, equal weight; the holdings panel can be collapsed to give analytics the full width). Each portfolio has its own benchmark (any Yahoo symbol: SPY, QQQ, ^BVSP…). Analytics are split into tabs:
  - *Evolution* (portfolios imported from transactions): market value vs net invested capital, weights over time as a stacked area, open positions with average cost and unrealized gain, and the imported trades.
  - *Performance*: Sharpe, Sortino, volatility, max drawdown, beta and growth vs the benchmark, per-holding risk contribution, and allocation by holding, sector and country. The risk-free rate defaults to the 13-week T-bill (`^IRX`) and can be overridden.
  - *Rolling & drawdowns* ([pyfolio-reloaded](https://github.com/stefan-jansen/pyfolio-reloaded)): rolling volatility, beta and Sharpe vs the benchmark, the underwater plot, the worst-drawdowns table, and the distribution and heatmap of monthly returns.
  - *Risk parity* ([PyPortfolioOpt](https://github.com/robertmartin8/PyPortfolioOpt) `HRPOpt`): Hierarchical Risk Parity weights compared with the current ones, the correlation matrix clustered in HRP order with its dendrogram (hover a cell to see both tickers, the correlation and their weights), and an in-sample backtest of both.
  - *Backtest*: allocation strategies replayed with [bt](https://github.com/pmorissette/bt) (see **Backtests** below).
- **Transaction import**: create a portfolio from B3's *Negociação* export (Área do Investidor → Extratos → Negociação → Excel). The open positions become the holdings, weighted by market value; weights are re-priced every time the portfolio is opened. Re-import a newer statement from the *Evolution* tab, or add and delete individual trades there (any portfolio, including a new empty one; B3 codes such as `PETR4` or `MGLU3F` and any Yahoo symbol are accepted, and the price defaults to that day's close). Sales larger than the shares held at that date are rejected. Adding trades to a portfolio with hand-set weights leaves those weights alone until you sync. Editing weights by hand turns them into fixed targets; *Sync weights to positions* switches back.
- **Screener**: Yahoo presets (gainers, most active, undervalued…) or custom screens with 26 range filters in six groups: valuation (market cap, P/E, PEG, P/B, P/S, EV/EBITDA), profitability (ROE, ROA, margins), growth, dividends, risk & leverage (beta, D/E, net debt/EBITDA, current ratio, short interest) and trading. Also region, sector and an OTC exclusion. Results are paginated server-side (25/50/100 per page) and sortable by column. Filters are declared once in `services/screener.py` (`RANGE_FILTERS`) and the form is built from that metadata.
- **Compare** (`/compare?tickers=A&tickers=B`): 2–4 stocks side by side. Shows return, volatility, Sharpe, Sortino and drawdown with the benchmark as a reference column; beta, correlation, R², Jensen's alpha and tracking error vs a benchmark of your choice; trailing 1M–5Y returns; growth, drawdown, relative-strength and rolling-correlation charts; the correlation matrix; TTM valuation and profitability; annual growth and margin history; and each stock's technical score.
- **Stock analysis** (`/stocks?ticker=…`): one page per stock with technical, fundamentals and forecast sections.
- **Forecast**: ARIMA forecast for 1–20 trading days with 80%/95% bands. The model is fitted on daily log returns, not prices; the forecast returns are compounded onto the last close to get the price path, and the bands come from the variance of the cumulative return (lognormal price bands). Order selection uses ADF on the returns for d (almost always 0) and AIC over p, q ∈ 0..2, or you can fix the order yourself. Shows Ljung-Box residual diagnostics and a pseudo out-of-sample backtest against a random walk. Also a GARCH(1,1) volatility study (normal, t or skewed-t shocks): conditional and long-run volatility, persistence, half-life, 1-day VaR, and a volatility forecast. Built on `statsmodels` and `arch`.
- **Technical**: candlestick (or line) chart with an indicator picker: SMA, EMA, Bollinger Bands, Volume, On-Balance Volume, RSI, MACD (all parameters editable). History is fetched with a warm-up window so long averages are populated from the first visible bar.
- **Backtests**: test a strategy on a stock (`/stocks?ticker=…#backtest`) or a portfolio (*Backtest* tab) over 6M–Max, with commission and slippage in basis points. Results show total return, CAGR, volatility, Sharpe, Sortino, max drawdown, trades, win rate, exposure, turnover and cost drag next to buy and hold and the benchmark, plus the equity curve (linear or log), drawdowns, the trades or rebalances table and a monthly-returns heatmap. Every run is saved with its settings and headline stats; *Load* re-runs a saved one.
  - *Stock strategies* (own pandas engine, `services/backtest/stock.py`): buy and hold, moving-average crossover (SMA/EMA), RSI mean reversion, MACD crossover, and the technical score (the 0–10 summary recomputed on every bar; enter above one level, exit below another; up to 10 years). Long or flat only. Signals are computed on a bar's close and executed at the next bar's open, so there is no look-ahead; indicators are computed on extra warm-up history before the period starts. Buy and hold enters at the first bar's open.
  - *Portfolio strategies* (`services/backtest/portfolio.py`, bt): buy and hold of the saved weights, saved weights rebalanced, equal weight, inverse volatility, minimum variance (PyPortfolioOpt, Ledoit-Wolf covariance) and HRP, rebalanced monthly, quarterly or yearly. Volatility, covariance and HRP clusters are estimated from a trailing lookback (1–60 months) of prices up to each rebalance date. bt trades at the rebalance day's close.
  - Strategies are declared once in `services/backtest/registry.py` (parameters with defaults and bounds, like the indicator registry) and the form is built from `GET /api/backtests/strategies`. To add one, register it there and implement it in `stock.SIGNALS` or `portfolio._weigh_algo`.
- **Technical score**: every indicator is scored 0 (bearish) to 10 (bullish) on the latest bar by a decision tree (`services/scoring.py`); the UI shows the branch taken. The summary is a weighted average; weights default to 1 and can already be passed to the API (`weights=macd:12,26,9=2`) ahead of a settings UI. `GET /api/market/{ticker}/score` returns scores without chart data.
- **Fundamental score**: eight factors scored 0 (weak / expensive) to 10 (strong / cheap) by decision trees (`services/fundamental_scoring.py`), in three groups: *growth* (revenue growth vs its 3-year CAGR; EPS CAGR and analysts' expected change), *quality* (ROE checked against ROA for leverage; operating margin level and trend; free-cash-flow conversion, margin and consistency over the last four quarters; net debt/EBITDA and current ratio) and *valuation* (P/E with PEG, value-trap check when forward P/E is above trailing, EV/Sales without earnings; current P/E vs its median at past fiscal year ends, which flags stocks that are stretched or cheap against their own history). Cash-flow and leverage factors are skipped for banks and insurers. The summary and each group are weighted averages (`weights=valuation=2`). `GET /api/fundamentals/{ticker}/score`; shown on the stock page and in Compare.
- **Fundamentals**: annual or quarterly revenue, gross profit, EBITDA, operating and net income, basic and diluted EPS, margins and growth, plus TTM figures.
- **Tooltips**: the ⓘ badges next to metrics and indicators explain them. Texts live in `frontend/src/lib/glossary.ts`.

## Project layout

```
backend/app/
  main.py                    FastAPI app, error handlers
  migrate.py, migrations/    Alembic migrations, applied automatically on startup
  models.py, schemas.py      Portfolio/Holding ORM models and API schemas
  routers/                   portfolios (CRUD + analytics, hrp, tearsheet), market (chart/score/search/screener), analysis (fundamentals, compare), backtests
  services/
    market_data.py           every yfinance call, with an in-memory TTL cache
    indicators.py            indicator registry: add new indicators here
    scoring.py               0-10 decision-tree scores per indicator + weighted summary
    portfolio_analytics.py   returns/risk statistics shared by the portfolio views
    transactions.py          B3 statement parser; replays transactions into positions, weights and their evolution
    hrp.py                   Hierarchical Risk Parity (PyPortfolioOpt)
    tearsheet.py             rolling metrics, drawdowns, monthly returns (pyfolio)
    backtest/                strategy registry, stock engine (pandas), portfolio engine (bt), shared results
    forecasting.py           ARIMA forecasts + backtest (statsmodels), GARCH volatility (arch)
    fundamentals.py          income-statement metrics
    fundamental_scoring.py   0-10 decision-tree scores for growth, quality and valuation factors
    compare.py               multi-stock comparison
    screener.py              Yahoo screener queries
frontend/src/
  app/                       one folder per page
  components/                charts, holdings editor, indicator picker, UI primitives
  lib/                       API client, types, formatters
```

## Notes and next steps

- Weights are stored as fractions (0–1) and must add up to at most 100%. Analytics rescale them to 100% and assume daily rebalancing.
- Schema changes go through Alembic: edit `models.py`, then `docker compose exec backend alembic revision --autogenerate -m "..."`. Migrations run on startup.
- `scipy` is pinned below 1.18 because PyPortfolioOpt 1.6's `HRPOpt` uses a private scipy attribute that 1.18 removed. Lift the pin once PyPortfolioOpt is fixed.
- Backtest API: `POST /api/backtests` with `{target: {type: "stock", ticker} | {type: "portfolio", portfolio_id}, strategy: {id, params}, period, benchmark, commission_bps, slippage_bps, risk_free_rate, save}`; `GET /api/backtests?ticker=…|portfolio_id=…`, `GET/DELETE /api/backtests/{id}`. Saved runs (table `backtest_runs`) keep the settings and summary stats, not the curves. The benchmark defaults to SPY for stocks and the saved benchmark for portfolios; `""` disables it.
- Transaction import (`POST /api/portfolios/import`, multipart `file` + `name`, `description`, `benchmark`; `POST /api/portfolios/{id}/transactions/import` to replace; `POST /api/portfolios/{id}/transactions` with `{date, kind: "buy"|"sell", ticker, quantity, price?}` and `DELETE /api/portfolios/{id}/transactions/{tx_id}` to add or remove one trade (both return the portfolio with rebuilt positions); `GET /api/portfolios/{id}/transactions?limit=25&offset=0` (one page, newest first, with `total`), `GET /api/portfolios/{id}/evolution`; `POST /api/portfolios/{id}/positions/sync`): trading codes map to Yahoo symbols as `CODE.SA` (fractional `CODE3F` → `CODE3.SA`; BDRs with a digit in the root such as A1LB34 too). Compra adds shares and Venda removes them; only *Mercado à Vista* and *Mercado Fracionário* trades count, so options and other derivatives are skipped. The statement has no corporate events or dividends: splits, reverse splits and stock bonuses come from Yahoo's split history and positions are valued with split-adjusted but not dividend-adjusted closes, so shares × close is the real market value. Sales larger than the shares in the file (statements that start after the first purchases) are capped at the shares held and reported as warnings; tickers Yahoo doesn't know (subscription rights such as KNCR12) are left out of the weights.
- Backtests are simplifications: cash earns nothing, there are no taxes, dividends are reinvested through adjusted prices, and costs are a flat bps charge on traded value.
- Yahoo's dividend adjustment sometimes produces negative or zero adjusted prices for early history (e.g. D1EL34.SA in 2021). `market_data.get_history` / `get_closes` treat non-positive prices as missing, so analytics, compare, HRP and backtests skip or forward-fill those days.
- `vectorbt` was not used because it requires pandas 3 (pyfolio and PyPortfolioOpt are on pandas 2); `backtesting.py` is AGPL and `backtrader` is unmaintained.
- ARIMA auto-selection fits 9 models (about 4 s in Docker, slower on Windows). Results are cached with the market data.
- Yahoo serves some statements in a different currency from the quote, sometimes without saying so (PETR4.SA and VALE3.SA statements are in USD but labelled BRL). The fundamental score compares the scale of annual and TTM revenue and skips price-vs-statement ratios (historical P/E, FCF yield) when they disagree; the income-statement charts still show the raw figures.
- The yfinance cache lives in process memory (15 min for prices, 6 h for fundamentals). Move it to Postgres or Redis if you run several workers.
- Natural next steps: mean-variance optimisation / efficient frontier (PyPortfolioOpt is already installed), walk-forward / parameter-sweep backtests and short or leveraged stock rules, tracking actual positions (shares and cost basis) alongside target weights, a UI for score weights, sector-relative thresholds for the fundamental score, and balance-sheet and cash-flow charts.
