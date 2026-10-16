"""Hierarchical Risk Parity (López de Prado) via PyPortfolioOpt's HRPOpt.

HRP clusters assets by the correlation of their returns, orders them so that
similar assets sit next to each other (quasi-diagonalisation) and splits
capital top-down between clusters in inverse proportion to their variance.
Besides the HRP weights we expose the clustered correlation matrix and the
dendrogram so the UI can show *why* HRP allocates the way it does.
"""

from typing import Any

import pandas as pd
from pypfopt import HRPOpt
from scipy.cluster.hierarchy import dendrogram

from app.services.market_data import clean_number
from app.services.portfolio_analytics import load_returns, resolve_risk_free, return_stats

LINKAGE_METHODS = ("single", "complete", "average", "ward")


def hrp_analysis(
    weights: dict[str, float],
    period: str = "1y",
    risk_free_rate: float | None = None,
    linkage_method: str = "single",
) -> dict[str, Any]:
    if linkage_method not in LINKAGE_METHODS:
        raise ValueError(f"linkage must be one of {', '.join(LINKAGE_METHODS)}")

    weights, asset_returns, portfolio_returns = load_returns(weights, period)
    if asset_returns.shape[1] < 2:
        raise ValueError("Hierarchical Risk Parity needs at least two holdings")
    rf = resolve_risk_free(risk_free_rate)

    hrp = HRPOpt(returns=asset_returns)
    hrp_weights = pd.Series(hrp.optimize(linkage_method=linkage_method), dtype=float)
    hrp_returns = asset_returns @ hrp_weights[asset_returns.columns]

    # Leaf order of the dendrogram == HRP's quasi-diagonal ordering.
    tree = dendrogram(hrp.clusters, labels=list(hrp.tickers), no_plot=True)
    order: list[str] = tree["ivl"]
    # HRPOpt clusters on the sample covariance of these same returns.
    corr = asset_returns.corr().loc[order, order]

    return {
        "period": period,
        "linkage": linkage_method,
        "risk_free_rate": rf,
        "current": return_stats(portfolio_returns, rf),
        "hrp": return_stats(hrp_returns, rf),
        "weights": [
            {
                "ticker": t,
                "current": weights[t],
                "hrp": clean_number(hrp_weights[t]),
            }
            for t in order
        ],
        "correlation": {
            "tickers": order,
            "matrix": [[clean_number(v) for v in row] for row in corr.to_numpy()],
        },
        # Each link joins two clusters: x in leaf-index units (0 = first ticker in `order`),
        # y is the HRP distance sqrt((1 - corr) / 2) at which they merge.
        "dendrogram": [
            {"x": [(x - 5) / 10 for x in xs], "y": [clean_number(y) for y in ys]}
            for xs, ys in zip(tree["icoord"], tree["dcoord"])
        ],
    }
