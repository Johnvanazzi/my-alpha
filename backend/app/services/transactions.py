"""Portfolios built from a statement of trades.

`parse_statement` reads B3's "Negociação" export (Área do Investidor → Extratos →
Negociação → Excel): one row per trade with the columns Data do Negócio, Tipo de
Movimentação (Compra/Venda), Mercado, Prazo/Vencimento, Instituição, Código de
Negociação, Quantidade, Preço and Valor. Only spot and fractional-market trades become
positions; options and other derivatives are skipped.

`simulate` replays the trades against Yahoo prices to get the share position of every
ticker on every trading day, which gives the current weights (shares x latest price) and
their evolution over time.

The statement has no corporate events, so quantities are converted to today's split
basis with Yahoo's split history and valued with split-adjusted (not dividend-adjusted)
closes: shares x close is then the real market value on each day.
"""

import io
import re
import unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import numpy as np
import pandas as pd

from app.services.market_data import MarketDataError, clean_number, get_split_adjusted_history

MAX_FILE_BYTES = 5 * 1024 * 1024
EPSILON = 1e-9

# Normalised header (no accents, lower case) -> field.
COLUMNS = {
    "data do negocio": "date",
    "tipo de movimentacao": "side",
    "mercado": "market",
    "instituicao": "institution",
    "codigo de negociacao": "code",
    "quantidade": "quantity",
    "preco": "price",
    "valor": "amount",
}
REQUIRED = ("date", "side", "code", "quantity", "price")

# Markets that hold shares (cash market and its odd-lot segment); anything else
# (options, forward contracts...) is not a position in the underlying.
SPOT_MARKETS = ("vista", "fracionario")

# Four-character root (BDRs such as A1LB34 or D1EL34 have a digit in it) + 1-2 digit suffix.
B3_TICKER = re.compile(r"^[A-Z][A-Z0-9]{3}\d{1,2}$")
PT_BR_THOUSANDS = re.compile(r"^-?\d{1,3}(\.\d{3})+$")


@dataclass
class Tx:
    date: date
    ticker: str
    kind: str  # buy | sell
    quantity: float
    price: float | None = None
    amount: float | None = None
    movement: str = ""
    institution: str | None = None


@dataclass
class ParsedStatement:
    transactions: list[Tx]
    rows: int
    skipped: dict[str, int] = field(default_factory=dict)


def _normalize(text: Any) -> str:
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text).strip().lower()


def _text(value: Any) -> str:
    return "" if value is None or (isinstance(value, float) and np.isnan(value)) else str(value).strip()


def _number(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, (int, float, np.number)):
        return float(value)
    text = str(value).strip().replace("R$", "").replace(" ", "")
    if text in ("", "-"):
        return None
    if "," in text or PT_BR_THOUSANDS.match(text):  # pt-BR: 1.234,56 or 1.000
        text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def _date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    parsed = pd.to_datetime(str(value).strip(), dayfirst=True, errors="coerce")
    return None if pd.isna(parsed) else parsed.date()


def yahoo_symbol(code: str) -> str:
    """'MGLU3' -> 'MGLU3.SA'; fractional-market codes like MGLU3F map to MGLU3."""
    code = str(code).strip().upper()
    if code.endswith("F") and B3_TICKER.match(code[:-1]):
        code = code[:-1]
    return f"{code}.SA" if B3_TICKER.match(code) else code


def _read_rows(content: bytes) -> pd.DataFrame:
    try:
        raw = pd.read_excel(io.BytesIO(content), header=None, dtype=object, engine="openpyxl")
    except Exception as exc:  # openpyxl raises a variety of errors for non-xlsx input
        raise ValueError("Could not read the file: upload the .xlsx exported from B3's Negociação page") from exc

    # The header is usually the first row, but tolerate a few title rows above it.
    for i in range(min(len(raw), 10)):
        mapping = {j: COLUMNS[h] for j, h in enumerate(_normalize(v) for v in raw.iloc[i]) if h in COLUMNS}
        if all(f in mapping.values() for f in REQUIRED):
            body = raw.iloc[i + 1 :, list(mapping)]
            body.columns = list(mapping.values())
            return body.dropna(how="all")
    raise ValueError(
        "Unrecognised spreadsheet: upload the Excel export of B3's Negociação page "
        "(Data do Negócio, Tipo de Movimentação, Código de Negociação, Quantidade, Preço)"
    )


def parse_statement(content: bytes) -> ParsedStatement:
    if len(content) > MAX_FILE_BYTES:
        raise ValueError("The file is larger than 5 MB")
    rows = _read_rows(content)
    transactions: list[Tx] = []
    skipped: Counter[str] = Counter()

    for _, row in rows.iterrows():
        side = _text(row.get("side"))
        market = _text(row.get("market"))
        day = _date(row.get("date"))
        code = _text(row.get("code"))
        quantity = _number(row.get("quantity"))
        price = _number(row.get("price"))
        if day is None or not code or quantity is None or quantity <= 0:
            skipped["incomplete row"] += 1
            continue
        if market and not any(m in _normalize(market) for m in SPOT_MARKETS):
            skipped[market] += 1
            continue
        if _normalize(side).startswith("compra"):
            kind = "buy"
        elif _normalize(side).startswith("venda"):
            kind = "sell"
        else:
            skipped["unknown Compra/Venda"] += 1
            continue

        amount = _number(row.get("amount"))
        transactions.append(
            Tx(
                date=day,
                ticker=yahoo_symbol(code)[:20],
                kind=kind,
                quantity=quantity,
                price=price if price and price > 0 else None,
                amount=abs(amount) if amount else None,
                movement=" · ".join(filter(None, (side, market)))[:80],
                institution=_text(row.get("institution"))[:120] or None,
            )
        )

    if not transactions:
        raise ValueError("No trades found in the spreadsheet")
    transactions.sort(key=lambda t: (t.date, t.kind != "buy"))
    return ParsedStatement(transactions=transactions, rows=len(rows), skipped=dict(skipped))


# --- Replaying transactions -------------------------------------------------------


@dataclass
class Simulation:
    start: date
    index: pd.DatetimeIndex
    quantities: pd.DataFrame  # shares per ticker per trading day (today's split basis)
    closes: pd.DataFrame  # split-adjusted closes, forward-filled
    invested: pd.Series  # cumulative net cash put in (buys - sales)
    cost: dict[str, float]  # remaining cost basis per ticker
    oversold: dict[str, float]  # shares sold beyond what the trades bought, per ticker
    unpriced: list[str]
    warnings: list[str]

    @property
    def values(self) -> pd.DataFrame:
        return (self.quantities * self.closes[self.quantities.columns]).fillna(0.0)


def _split_factor_after(history: pd.DataFrame, day: pd.Timestamp) -> float:
    """How many of today's shares one share held on `day` became (product of later splits)."""
    splits = history["split"]
    later = splits[(splits.index > day) & (splits > 0)]
    return float(later.prod()) if len(later) else 1.0


def _price_on(history: pd.DataFrame, day: pd.Timestamp) -> float:
    close = history["close"].asof(day)
    return float(history["close"].iloc[0] if pd.isna(close) else close)


def simulate(transactions: list[Tx]) -> Simulation:
    if not transactions:
        raise ValueError("The portfolio has no transactions")
    start = min(t.date for t in transactions)
    tickers = sorted({t.ticker for t in transactions})

    def fetch(ticker: str) -> pd.DataFrame | None:
        try:
            return get_split_adjusted_history(ticker, start)
        except MarketDataError:
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        histories = {t: h for t, h in zip(tickers, pool.map(fetch, tickers)) if h is not None}
    unpriced = [t for t in tickers if t not in histories]
    if not histories:
        raise MarketDataError("No price history found for any ticker in the transactions")

    held: dict[str, float] = defaultdict(float)
    cost: dict[str, float] = defaultdict(float)
    deltas: list[tuple[pd.Timestamp, str, float]] = []
    flows: list[tuple[pd.Timestamp, float]] = []
    oversold: dict[str, float] = defaultdict(float)

    for tx in sorted(transactions, key=lambda t: (t.date, t.kind != "buy")):
        day = pd.Timestamp(tx.date)
        history = histories.get(tx.ticker)
        if history is None:
            continue
        factor = _split_factor_after(history, day)
        shares = tx.quantity * factor
        # Price per share in today's split basis; fall back to the day's close if a row has none.
        price = tx.price / factor if tx.price else _price_on(history, day)
        if tx.kind == "buy":
            held[tx.ticker] += shares
            cost[tx.ticker] += shares * price
            deltas.append((day, tx.ticker, shares))
            flows.append((day, shares * price))
        else:
            sold = min(shares, held[tx.ticker])
            if shares - sold > EPSILON:
                # Reported in the statement's share count (before later splits), like the rows themselves.
                oversold[tx.ticker] += (shares - sold) / factor
            if held[tx.ticker] > EPSILON:
                cost[tx.ticker] *= 1 - sold / held[tx.ticker]
            held[tx.ticker] -= sold
            if held[tx.ticker] < EPSILON:
                held[tx.ticker] = 0.0
                cost[tx.ticker] = 0.0
            deltas.append((day, tx.ticker, -sold))
            flows.append((day, -sold * price))

    start_ts = pd.Timestamp(start)
    index = pd.DatetimeIndex(sorted({d for h in histories.values() for d in h.index if d >= start_ts}))
    closes = pd.DataFrame({t: h["close"] for t, h in histories.items()}).reindex(index).ffill()

    def cumulative(frame: pd.DataFrame | pd.Series) -> Any:
        full = frame.index.union(index)
        return frame.reindex(full).fillna(0.0).cumsum().reindex(index)

    priced = sorted(histories)
    if deltas:
        delta_frame = pd.DataFrame(deltas, columns=["date", "ticker", "shares"]).pivot_table(
            index="date", columns="ticker", values="shares", aggfunc="sum"
        )
        quantities = cumulative(delta_frame.reindex(columns=priced)).clip(lower=0)
    else:
        quantities = pd.DataFrame(0.0, index=index, columns=priced)

    if flows:
        invested = cumulative(pd.Series(dict(pd.DataFrame(flows).groupby(0)[1].sum())))
    else:
        invested = pd.Series(0.0, index=index)

    warnings = [
        f"{t}: sales exceed the purchases in the file by {shares:,.0f} shares; the statement probably starts "
        "after some of them were bought, so the excess was ignored."
        for t, shares in sorted(oversold.items())
    ]
    if unpriced:
        warnings.append(
            f"No market data for {', '.join(unpriced)} (subscription rights, delisted or renamed tickers); left out of the weights."
        )

    return Simulation(
        start=start,
        index=index,
        quantities=quantities,
        closes=closes,
        invested=invested,
        cost=dict(cost),
        oversold=dict(oversold),
        unpriced=unpriced,
        warnings=warnings,
    )


def current_positions(sim: Simulation) -> list[dict[str, Any]]:
    """Open positions valued at the latest close, largest first.

    Shares are rounded down: fractions left by reverse splits and stock bonuses are
    auctioned off by B3 ("leilão de frações"), so they are not held anymore.
    """
    last_qty = np.floor(sim.quantities.iloc[-1] + 1e-6)
    last_close = sim.closes.iloc[-1]
    values = (last_qty * last_close[last_qty.index]).fillna(0.0)
    total = float(values.sum())
    positions = []
    for ticker, shares in last_qty.items():
        value = float(values[ticker])
        if shares <= EPSILON or value <= 0:
            continue
        cost = sim.cost.get(ticker, 0.0)
        positions.append(
            {
                "ticker": ticker,
                "quantity": clean_number(shares),
                "price": clean_number(last_close[ticker]),
                "value": clean_number(value),
                "weight": value / total,
                "avg_price": clean_number(cost / shares) if cost else None,
                "cost": clean_number(cost),
                "unrealized": clean_number(value - cost) if cost else None,
            }
        )
    return sorted(positions, key=lambda p: -p["value"])


def prices_as_of(sim: Simulation) -> date:
    return sim.index[-1].date()


def evolution(sim: Simulation) -> dict[str, Any]:
    values = sim.values
    total = values.sum(axis=1)
    active = total > 0
    weights = values.div(total.where(active), axis=0)
    tickers = [t for t in values.columns if (values[t] > 0).any()]

    points = []
    for day in sim.index[active.to_numpy()]:
        row = weights.loc[day]
        points.append(
            {
                "date": day.date().isoformat(),
                "value": clean_number(total[day]),
                "invested": clean_number(sim.invested[day]),
                "weights": {t: round(float(row[t]), 6) for t in tickers if row[t] > 0},
            }
        )

    positions = current_positions(sim)
    return {
        "start": sim.start.isoformat(),
        "end": prices_as_of(sim).isoformat(),
        "tickers": tickers,
        "points": points,
        "positions": positions,
        "totals": {
            "value": clean_number(sum(p["value"] for p in positions)),
            "invested": clean_number(sim.invested.iloc[-1]),
            "cost": clean_number(sum(p["cost"] or 0 for p in positions)),
        },
        "unpriced": sim.unpriced,
        "warnings": sim.warnings,
    }
