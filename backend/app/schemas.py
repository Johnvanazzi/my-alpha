from datetime import date, datetime
from typing import Annotated, Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models import DEFAULT_BENCHMARK

WEIGHT_TOLERANCE = 1e-6


def _validate_holdings(holdings: list["HoldingIn"]) -> list["HoldingIn"]:
    tickers = [h.ticker for h in holdings]
    if len(tickers) != len(set(tickers)):
        raise ValueError("duplicate tickers in holdings")
    if sum(h.weight for h in holdings) > 1 + WEIGHT_TOLERANCE:
        raise ValueError("weights must add up to at most 100%")
    return holdings


def _clean_ticker(value: str) -> str:
    value = value.strip().upper()
    if not value:
        raise ValueError("ticker must not be empty")
    return value


def _clean_optional_ticker(value: str | None) -> str | None:
    return None if value is None else _clean_ticker(value)


# --- Portfolios ---------------------------------------------------------------


class HoldingIn(BaseModel):
    ticker: str = Field(max_length=20)
    weight: float = Field(gt=0, le=1)

    _ticker = field_validator("ticker")(_clean_ticker)


class HoldingUpdate(BaseModel):
    weight: float = Field(gt=0, le=1)


class HoldingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticker: str
    weight: float
    quantity: float | None = None


class PortfolioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    benchmark: str = Field(default=DEFAULT_BENCHMARK, max_length=20)
    holdings: list[HoldingIn] = []

    _holdings = field_validator("holdings")(_validate_holdings)
    _benchmark = field_validator("benchmark")(_clean_ticker)


class PortfolioCopy(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)


class PortfolioUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    benchmark: str | None = Field(default=None, max_length=20)

    _benchmark = field_validator("benchmark")(_clean_optional_ticker)


class PortfolioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    benchmark: str
    created_at: datetime
    updated_at: datetime
    holdings: list[HoldingOut]
    total_weight: float
    # Set when the holdings are share positions from imported transactions; weights
    # then follow market prices (this is the date of the prices last used).
    weights_as_of: date | None = None
    transaction_count: int = 0


class HoldingsReplace(BaseModel):
    holdings: list[HoldingIn]

    _holdings = field_validator("holdings")(_validate_holdings)


# --- Transactions -----------------------------------------------------------------


class TransactionIn(BaseModel):
    """A trade entered by hand. B3 codes such as PETR4 or MGLU3F become Yahoo symbols (PETR4.SA)."""

    date: date
    ticker: str = Field(max_length=20)
    kind: Literal["buy", "sell"]
    quantity: float = Field(gt=0)
    # Unit price; defaults to that day's close.
    price: float | None = Field(default=None, gt=0)
    institution: str | None = Field(default=None, max_length=120)

    _ticker = field_validator("ticker")(_clean_ticker)

    @field_validator("date")
    @classmethod
    def _not_in_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("the trade date cannot be in the future")
        return value


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date
    ticker: str
    kind: str
    quantity: float
    price: float | None
    amount: float | None
    movement: str
    institution: str | None


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int
    limit: int
    offset: int


class ImportSummary(BaseModel):
    rows: int
    transactions: int
    start: date
    end: date
    tickers: list[str]
    skipped: dict[str, int]
    unpriced: list[str]
    warnings: list[str]


class ImportResult(BaseModel):
    portfolio: PortfolioOut
    summary: ImportSummary


# --- Backtests ------------------------------------------------------------------


class StockTarget(BaseModel):
    type: Literal["stock"]
    ticker: str = Field(max_length=20)

    _ticker = field_validator("ticker")(_clean_ticker)


class PortfolioTarget(BaseModel):
    type: Literal["portfolio"]
    portfolio_id: int


class StrategySpec(BaseModel):
    id: str
    params: dict[str, Any] = {}


class BacktestRequest(BaseModel):
    target: Annotated[StockTarget | PortfolioTarget, Field(discriminator="type")]
    strategy: StrategySpec
    period: str = "5y"
    # Defaults to SPY for stocks and the portfolio's saved benchmark for portfolios; "" disables it.
    benchmark: str | None = Field(default=None, max_length=20)
    commission_bps: float = Field(default=5, ge=0, le=500)
    slippage_bps: float = Field(default=5, ge=0, le=500)
    risk_free_rate: float | None = Field(default=None, description="Annual rate as a fraction; defaults to ^IRX")
    save: bool = True


class BacktestRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    target_type: str
    ticker: str | None
    portfolio_id: int | None
    strategy_id: str
    params: dict[str, Any]
    config: dict[str, Any]
    summary: dict[str, Any]
