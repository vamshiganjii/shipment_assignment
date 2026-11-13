"""Route scoring engine.

Pipeline for one shipment:
  1. Hard constraints   - drop routes that miss the deadline / budget / cargo rules
  2. Expected cost      - freight + expected late penalty + expected cargo loss
  3. Pareto filter      - drop routes that are dominated on every criterion
  4. TOPSIS ranking     - closeness to the ideal route under priority weights

Pure functions over plain dicts (no FastAPI) so they are easy to test and reuse.
All criteria are "lower is better".
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np

CRITERIA: tuple[str, ...] = ("cost", "time", "risk", "delay")

# What "optimal" means for each shipment priority (rows sum to 1)
WEIGHTS: dict[str, dict[str, float]] = {
    # Each goal puts 60% on its own factor so the goal visibly drives the choice.
    # "risk_averse" targets route risk (conflict zones, congestion), not on-time
    # reliability, so it does not collapse into "fastest" (air is the most reliable).
    "cost":        {"cost": 0.60, "time": 0.15, "risk": 0.10, "delay": 0.15},
    "time":        {"cost": 0.15, "time": 0.60, "risk": 0.10, "delay": 0.15},
    "risk_averse": {"cost": 0.15, "time": 0.15, "risk": 0.60, "delay": 0.10},
    "balanced":    {"cost": 0.30, "time": 0.25, "risk": 0.20, "delay": 0.25},
}

GEO_RISK_SHARE = 0.6  # risk index = 0.6 * geopolitical + 0.4 * congestion


def normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    missing = [c for c in CRITERIA if c not in weights]
    if missing:
        raise ValueError(f"missing weights: {missing}")
    if any(weights[c] < 0 for c in CRITERIA):
        raise ValueError("weights must be non-negative")
    total = sum(weights[c] for c in CRITERIA)
    if total <= 0:
        raise ValueError("at least one weight must be greater than 0")
    return {c: weights[c] / total for c in CRITERIA}


def risk_index(route: dict[str, Any]) -> float:
    return GEO_RISK_SHARE * route["geopolitical_risk"] + (1 - GEO_RISK_SHARE) * route["congestion_risk"]


def check_feasibility(route: dict[str, Any], shipment: dict[str, Any]) -> list[str]:
    """Return the reasons a route is not allowed (empty list = feasible)."""
    reasons: list[str] = []
    if route["expected_transit_days"] > shipment["max_transit_days"]:
        reasons.append(
            # rounded up, so a route 0.3 days late never reads as "47 > 47"
            f"misses deadline ({math.ceil(route['expected_transit_days'])} > {shipment['max_transit_days']:.0f} days)"
        )
    if route["total_cost_usd"] > shipment["budget_usd"]:
        reasons.append(f"over budget (${route['total_cost_usd']:,.0f} > ${shipment['budget_usd']:,.0f})")
    if shipment.get("hazardous") and "air" in route["modes"]:
        reasons.append("hazardous cargo not allowed on air")
    return reasons


# Fallback tolerance: when nothing fits, routes within this much of the closest miss compete
VIOLATION_TOLERANCE = 0.10  # = 10% of a limit (e.g. 2 extra days on a 20-day deadline)


def limit_violation(route: dict[str, Any], shipment: dict[str, Any]) -> float:
    """How far a route misses the limits, relative to the limits (0 = fits).

    Days late / deadline + cost over / budget. A forbidden mode (hazardous cargo by air)
    counts as a very large violation, because it can never be accepted.
    """
    late = max(0.0, route["expected_transit_days"] - shipment["max_transit_days"]) / max(shipment["max_transit_days"], 1e-9)
    over = max(0.0, route["total_cost_usd"] - shipment["budget_usd"]) / max(shipment["budget_usd"], 1e-9)
    forbidden = 100.0 if shipment.get("hazardous") and "air" in route["modes"] else 0.0
    return late + over + forbidden


def build_metrics(route: dict[str, Any], shipment: dict[str, Any]) -> dict[str, float]:
    # expected_delay_days is already probability-weighted in the dataset
    late_cost = route["expected_delay_days"] * shipment["late_penalty_usd_per_day"]
    expected_total_cost = route["total_cost_usd"] + late_cost + route["expected_loss_usd"]
    return {
        "cost": float(expected_total_cost),
        "time": float(route["expected_transit_days"]),
        "risk": float(risk_index(route)),
        "delay": float(route["delay_probability"]),
    }


def dominates(a: dict[str, float], b: dict[str, float]) -> bool:
    """a dominates b if a is <= on every criterion and strictly < on at least one."""
    return all(a[c] <= b[c] for c in CRITERIA) and any(a[c] < b[c] for c in CRITERIA)


def pareto_flags(metrics: list[dict[str, float]]) -> list[bool]:
    n = len(metrics)
    return [not any(dominates(metrics[j], metrics[i]) for j in range(n) if j != i) for i in range(n)]


def topsis(metrics: list[dict[str, float]], weights: dict[str, float]) -> np.ndarray:
    """TOPSIS with min-max normalisation.

    Min-max (rather than classic vector normalisation) maps each criterion onto the
    0..1 range spanned by the options being compared. Vector normalisation lets one
    outlier (e.g. air freight at 10x the cost) squash the differences between the
    other routes, so a 60% "cost" weight would barely separate two sea routes.
    """
    X = np.array([[m[c] for c in CRITERIA] for m in metrics], dtype=float)
    lo, hi = X.min(axis=0), X.max(axis=0)
    span = np.where(hi - lo == 0, 1.0, hi - lo)             # identical values -> all 0
    V = ((X - lo) / span) * np.array([weights[c] for c in CRITERIA])
    ideal, worst = V.min(axis=0), V.max(axis=0)             # lower is better for all
    d_best = np.linalg.norm(V - ideal, axis=1)
    d_worst = np.linalg.norm(V - worst, axis=1)
    total = d_best + d_worst
    safe_total = np.where(total == 0, 1.0, total)
    return np.where(total == 0, 1.0, d_worst / safe_total)  # 1 = ideal, 0 = worst


#  orchestrator
def recommend(shipment: dict[str, Any], weights: dict[str, float] | None = None) -> dict[str, Any]:
    if not shipment.get("routes"):
        raise ValueError(f"shipment {shipment.get('shipment_id')} has no route options")
    weights = normalize_weights(weights or WEIGHTS[shipment["priority"]])

    rows: list[dict[str, Any]] = []
    for r in shipment["routes"]:
        reasons = check_feasibility(r, shipment)
        rows.append({
            "route": r, "metrics": build_metrics(r, shipment),
            "feasible": not reasons, "rejected_reasons": reasons,
            "pareto_optimal": None, "score": None,
        })

    candidates = [x for x in rows if x["feasible"]]
    no_feasible = not candidates
    if no_feasible:
        # Fallback: nothing fits, so keep only the routes that come closest to the limits
        # (e.g. 0.1 day late beats 21 days late), then let the goal's weights choose among them.
        for x in rows:
            x["violation"] = limit_violation(x["route"], shipment)
        closest = min(x["violation"] for x in rows)
        candidates = [x for x in rows if x["violation"] <= closest + VIOLATION_TOLERANCE]

    for x, flag in zip(candidates, pareto_flags([c["metrics"] for c in candidates])):
        x["pareto_optimal"] = flag
    pool = [x for x in candidates if x["pareto_optimal"]]

    for x, s in zip(pool, topsis([p["metrics"] for p in pool], weights)):
        x["score"] = round(float(s), 4)

    ranked = sorted(pool, key=lambda x: -x["score"])
    ranked_ids = {id(x) for x in ranked}
    others = [x for x in rows if id(x) not in ranked_ids]
    return {
        "weights": weights, "ranked": ranked, "others": others,
        "best": ranked[0], "no_feasible_route": no_feasible,
    }
