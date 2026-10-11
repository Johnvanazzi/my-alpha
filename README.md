# my-alpha

Track portfolios, screen stocks, and study price action and financial reports. Market data comes from Yahoo Finance via [yfinance](https://github.com/ranaroussi/yfinance).

| Layer    | Stack                                                    |
| -------- | -------------------------------------------------------- |
| Frontend | Next.js 16 (App Router), React 19, Tailwind 4, Recharts  |
| Backend  | FastAPI, SQLAlchemy 2, pandas, yfinance                  |
| Database | PostgreSQL 17                                            |

## Run it

```bash
docker compose up --build
```

- App: http://localhost:3000
- API docs (Swagger): http://localhost:8000/docs

The compose stack runs in development mode. `backend/app` and `frontend` are bind-mounted, so code changes reload automatically. The browser only talks to Next.js, which proxies `/api/*` to FastAPI (see `frontend/next.config.ts`).

For a production frontend image, build the `prod` target: `docker build --target prod frontend`.

## Features

- **Portfolios**: create portfolios of tickers and weights and edit them in place (scale to 100%, equal weight). Analytics include Sharpe, Sortino, volatility, max drawdown, beta and growth vs SPY, per-holding risk contribution, a correlation matrix, and allocation by holding, sector and country.
- **Sharpe calculator**: any mix of tickers and weights over a chosen lookback. The risk-free rate defaults to the 13-week T-bill (`^IRX`) and can be overridden.
- **Screener**: Yahoo presets (gainers, most active, undervalued…) or custom filters on region, sector, market cap, P/E, dividend yield, revenue growth and price.
- **Technical**: price chart with an indicator picker: SMA, EMA, Bollinger Bands, Volume, RSI, MACD (all parameters editable). History is fetched with a warm-up window so long averages are populated from the first visible bar.
- **Fundamentals**: annual or quarterly revenue, gross profit, EBITDA, operating and net income, basic and diluted EPS, margins and growth, plus TTM figures.

## Project layout

```
backend/app/
  main.py                    FastAPI app, error handlers, table creation
  models.py, schemas.py      Portfolio/Holding ORM models and API schemas
  routers/                   portfolios, market (chart/search/screener), analysis (sharpe, fundamentals)
  services/
    market_data.py           every yfinance call, with an in-memory TTL cache
    indicators.py            indicator registry: add new indicators here
    portfolio_analytics.py   returns/risk statistics: home for future optimisation
    fundamentals.py          income-statement metrics
    screener.py              Yahoo screener queries
frontend/src/
  app/                       one folder per page
  components/                charts, holdings editor, indicator picker, UI primitives
  lib/                       API client, types, formatters
```

## Notes and next steps

- Weights are stored as fractions (0–1) and must add up to at most 100%. Analytics rescale them to 100% and assume daily rebalancing.
- Tables are created on startup with `create_all`. Add Alembic before the schema starts changing.
- The yfinance cache lives in process memory (15 min for prices, 6 h for fundamentals). Move it to Postgres or Redis if you run several workers.
- Natural next steps: mean-variance optimisation / efficient frontier in `portfolio_analytics.py`, tracking actual positions (shares and cost basis) alongside target weights, candlestick rendering, and balance-sheet and cash-flow metrics.
