"""Uncertainty and sensitivity analysis.

* Weight sensitivity: nudge each weight up/down and re-run the recommender.
* Monte Carlo: route estimates (cost, transit time, delay, risk) are uncertain,
  so we re-sample them many times and count how often each route wins.
"""
from __future__ import annotations

import random
from collections import Counter
from typing import Any

from services.engine.scoring import CRITERIA, normalize_weights, recommend


def _clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def weight_scenarios(base: dict[str, float], delta: float) -> list[tuple[str, dict[str, float]]]:
    """Each criterion +/- delta (relative), renormalised, plus an equal-weights check."""
    scenarios: list[tuple[str, dict[str, float]]] = []
    for c in CRITERIA:
        for sign, label in ((1, "+"), (-1, "-")):
            w = dict(base)
            w[c] = max(0.0, w[c] * (1 + sign * delta))
            scenarios.append((f"{c} {label}{delta:.0%}", normalize_weights(w)))
    scenarios.append(("equal weights", {c: 1 / len(CRITERIA) for c in CRITERIA}))
    return scenarios


def perturb_shipment(shipment: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    """Return a copy of the shipment with noisy route estimates (legs untouched)."""
    routes = []
    for r in shipment["routes"]:
        r2 = dict(r)
        r2["total_cost_usd"] = r["total_cost_usd"] * max(0.5, rng.gauss(1.0, 0.08))
        r2["expected_transit_days"] = max(
            0.5, r["expected_transit_days"] + rng.gauss(0, 0.5 * r["transit_days_std"])
        )
        r2["delay_probability"] = _clip(r["delay_probability"] + rng.gauss(0, 0.05), 0.0, 0.99)
        r2["on_time_reliability"] = 1 - r2["delay_probability"]
        r2["expected_delay_days"] = max(0.0, r["expected_delay_days"] * rng.lognormvariate(0, 0.25))
        r2["geopolitical_risk"] = _clip(r["geopolitical_risk"] + rng.gauss(0, 0.05), 0.0, 1.0)
        r2["congestion_risk"] = _clip(r["congestion_risk"] + rng.gauss(0, 0.05), 0.0, 1.0)
        routes.append(r2)
    return {**shipment, "routes": routes}


def monte_carlo(
    shipment: dict[str, Any], weights: dict[str, float], n_samples: int, seed: int
) -> dict[str, float]:
    """Share of simulations in which each route is recommended."""
    rng = random.Random(seed)
    wins: Counter[str] = Counter()
    for _ in range(n_samples):
        best = recommend(perturb_shipment(shipment, rng), weights)["best"]
        wins[best["route"]["route_id"]] += 1
    return {rid: round(cnt / n_samples, 4) for rid, cnt in wins.most_common()}
