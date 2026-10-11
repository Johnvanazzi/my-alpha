from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

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


class PortfolioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    holdings: list[HoldingIn] = []

    _holdings = field_validator("holdings")(_validate_holdings)


class PortfolioUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class PortfolioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
    holdings: list[HoldingOut]
    total_weight: float


class HoldingsReplace(BaseModel):
    holdings: list[HoldingIn]

    _holdings = field_validator("holdings")(_validate_holdings)


# --- Analytics ----------------------------------------------------------------


class SharpeRequest(BaseModel):
    holdings: list[HoldingIn] = Field(min_length=1)
    period: str = "1y"
    risk_free_rate: float | None = Field(
        default=None, description="Annual risk-free rate as a fraction. Defaults to the 13-week T-bill (^IRX)."
    )
