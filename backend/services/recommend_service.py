"""Recommendation, sensitivity and evaluation use-cases.

Glues the pure scoring engine to the API schemas in schemas/.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from statistics import mean
from typing import Any

from core.config import Settings, get_settings
from core.exceptions import InvalidInputError
from services.engine.explain import explain
from services.engine.scoring import (
    WEIGHTS, build_metrics, check_feasibility, dominates, pareto_flags, recommend, risk_index,
)
from services.engine.uncertainty import monte_carlo, weight_scenarios
from services.shipment_service import ShipmentService, get_shipment_service
from schemas.recommend_schema import (
    Constraints, EvaluationResponse, MonteCarloResult, RecommendationResponse,
    RouteEvaluation, RouteMetrics, SensitivityResponse, ShipmentEvaluation,
    StrategySummary, WeightScenario, Weights,
)
from schemas.shipment_schema import Priority

logger = logging.getLogger(__name__)

STABLE, MODERATE = 0.8, 0.6  # verdict thresholds


class RecommendService:
    def __init__(self, shipments: ShipmentService, settings: Settings):
        self._shipments = shipments
        self._settings = settings
        self._evaluation_cache: EvaluationResponse | None = None

    @staticmethod
    def _apply_overrides(
        shipment: dict[str, Any],
        priority: Priority | None,
        max_transit_days: float | None,
        budget_usd: float | None,
    ) -> dict[str, Any]:
        s = dict(shipment)
        if priority is not None:
            s["priority"] = priority
        if max_transit_days is not None:
            s["max_transit_days"] = max_transit_days
        if budget_usd is not None:
            s["budget_usd"] = budget_usd
        return s

    @staticmethod
    def _run(shipment: dict[str, Any], weights: dict[str, float] | None) -> dict[str, Any]:
        try:
            return recommend(shipment, weights)
        except ValueError as e:
            raise InvalidInputError(str(e)) from e

    @staticmethod
    def _route_evaluation(x: dict[str, Any], rank: int | None, is_best: bool) -> RouteEvaluation:
        r, m = x["route"], x["metrics"]
        if is_best:
            status = "recommended"
        elif rank is not None:
            status = "ranked"
        elif not x["feasible"] and x["pareto_optimal"] is None:
            status = "rejected"
        else:
            status = "dominated"
        return RouteEvaluation(
            route_id=r["route_id"], route_name=r["route_name"], route_type=r["route_type"],
            carrier=r["carrier"], hubs_path=r["hubs_path"],
            total_cost_usd=r["total_cost_usd"], expected_transit_days=r["expected_transit_days"],
            on_time_reliability=r["on_time_reliability"], delay_probability=r["delay_probability"],
            geopolitical_risk=r["geopolitical_risk"], congestion_risk=r["congestion_risk"],
            co2_tonnes=r["co2_tonnes"],
            metrics=RouteMetrics(
                expected_total_cost_usd=round(m["cost"], 2), expected_transit_days=m["time"],
                risk_index=round(m["risk"], 4), delay_probability=m["delay"],
            ),
            status=status, feasible=x["feasible"], pareto_optimal=x["pareto_optimal"],
            score=x["score"], rank=rank, rejected_reasons=x["rejected_reasons"],
        )

    def recommend(
        self,
        shipment_id: str,
        priority: Priority | None = None,
        weights: Weights | None = None,
        max_transit_days: float | None = None,
        budget_usd: float | None = None,
    ) -> RecommendationResponse:
        shipment = self._apply_overrides(
            self._shipments.get_raw(shipment_id), priority, max_transit_days, budget_usd
        )
        result = self._run(shipment, weights.model_dump() if weights else None)
        best = result["best"]

        routes = [
            self._route_evaluation(x, rank=i, is_best=(i == 1))
            for i, x in enumerate(result["ranked"], start=1)
        ] + [self._route_evaluation(x, rank=None, is_best=False) for x in result["others"]]

        return RecommendationResponse(
            shipment_id=shipment_id,
            priority=shipment["priority"],
            weights=Weights(**result["weights"]),
            constraints=Constraints(
                max_transit_days=shipment["max_transit_days"],
                budget_usd=shipment["budget_usd"],
                hazardous=shipment["hazardous"],
            ),
            recommended_route_id=best["route"]["route_id"],
            recommended_route_name=best["route"]["route_name"],
            no_feasible_route=result["no_feasible_route"],
            explanation=explain(shipment, result),
            routes=routes,
        )

    def sensitivity(
        self,
        shipment_id: str,
        delta: float | None = None,
        n_samples: int | None = None,
        seed: int | None = None,
    ) -> SensitivityResponse:
        delta = self._settings.sensitivity_delta if delta is None else delta
        n_samples = self._settings.monte_carlo_samples if n_samples is None else n_samples
        seed = self._settings.monte_carlo_seed if seed is None else seed

        shipment = self._shipments.get_raw(shipment_id)
        base = self._run(shipment, None)
        base_weights = base["weights"]
        base_id = base["best"]["route"]["route_id"]
        margin = (
            round(base["ranked"][0]["score"] - base["ranked"][1]["score"], 4)
            if len(base["ranked"]) > 1 else None
        )

        scenarios = []
        for name, w in weight_scenarios(base_weights, delta):
            pick = self._run(shipment, w)["best"]["route"]["route_id"]
            scenarios.append(WeightScenario(
                name=name, weights=Weights(**w), recommended_route_id=pick, same_as_base=(pick == base_id),
            ))
        weight_stability = round(mean(s.same_as_base for s in scenarios), 4)

        win_rates = monte_carlo(shipment, base_weights, n_samples, seed)
        mc_rate = win_rates.get(base_id, 0.0)

        worst = min(weight_stability, mc_rate)
        verdict = "stable" if worst >= STABLE else "moderately_stable" if worst >= MODERATE else "sensitive"
        flips = sorted({s.recommended_route_id for s in scenarios if not s.same_as_base})
        summary = (
            f"{base_id} stays the pick in {weight_stability:.0%} of weight scenarios (±{delta:.0%}) "
            f"and wins {mc_rate:.0%} of {n_samples} Monte Carlo simulations of cost/time/risk uncertainty."
        )
        if flips:
            summary += f" Alternatives that can take over: {', '.join(flips)}."
        if verdict == "sensitive":
            summary += " Treat this as a close call and review the trade-off manually."

        return SensitivityResponse(
            shipment_id=shipment_id, base_route_id=base_id, base_weights=Weights(**base_weights),
            score_margin=margin, weight_delta=delta, weight_scenarios=scenarios,
            weight_stability=weight_stability,
            monte_carlo=MonteCarloResult(
                n_samples=n_samples, seed=seed, base_pick_win_rate=mc_rate, route_win_rates=win_rates,
            ),
            verdict=verdict, summary=summary,
        )

    def evaluate(self) -> EvaluationResponse:
        """Compare the system against single-objective baselines on every shipment.

        The dataset is static, so the result is computed once and cached.
        """
        if self._evaluation_cache is not None:
            return self._evaluation_cache

        picks: dict[str, list[dict[str, float | bool]]] = {
            k: [] for k in ("system", "always_cheapest", "always_fastest", "always_safest")
        }
        per_shipment: list[ShipmentEvaluation] = []
        no_feasible = 0
        stable_count = 0

        for s in self._shipments.all_raw():
            routes = s["routes"]
            result = self._run(s, None)
            no_feasible += result["no_feasible_route"]

            metrics = [build_metrics(r, s) for r in routes]
            pareto = pareto_flags(metrics)
            cheapest_cost = min(r["total_cost_usd"] for r in routes)
            best_expected = min(m["cost"] for m in metrics)
            fastest_days = min(r["expected_transit_days"] for r in routes)

            idx = {r["route_id"]: i for i, r in enumerate(routes)}
            chosen = {
                "system": idx[result["best"]["route"]["route_id"]],
                "always_cheapest": min(range(len(routes)), key=lambda i: routes[i]["total_cost_usd"]),
                "always_fastest": min(range(len(routes)), key=lambda i: routes[i]["expected_transit_days"]),
                "always_safest": min(
                    range(len(routes)), key=lambda i: (risk_index(routes[i]), routes[i]["delay_probability"])
                ),
            }
            feasible_idx = [j for j, r in enumerate(routes) if not check_feasibility(r, s)]

            def sound(i: int) -> bool:
                # Within limits and not beaten on every factor by another route that is also within limits.
                # If nothing fits, the least-bad option counts as sound when it is Pareto-optimal.
                if not feasible_idx:
                    return pareto[i]
                return i in feasible_idx and not any(
                    dominates(metrics[j], metrics[i]) for j in feasible_idx if j != i
                )

            for strategy, i in chosen.items():
                r = routes[i]
                picks[strategy].append({
                    "feasible": not check_feasibility(r, s),
                    "pareto": pareto[i],
                    "sound": sound(i),
                    "freight_premium": (r["total_cost_usd"] / cheapest_cost - 1) * 100,
                    "expected_premium": (metrics[i]["cost"] / best_expected - 1) * 100,
                    "extra_days": r["expected_transit_days"] - fastest_days,
                    "delay": r["delay_probability"],
                    "geo": r["geopolitical_risk"],
                })

            # Weight-only stability (cheap); Monte Carlo is left to /sensitivity
            base_id = result["best"]["route"]["route_id"]
            stable = all(
                self._run(s, w)["best"]["route"]["route_id"] == base_id
                for _, w in weight_scenarios(result["weights"], self._settings.sensitivity_delta)[:-1]
            )
            stable_count += stable

            per_shipment.append(ShipmentEvaluation(
                shipment_id=s["shipment_id"], priority=s["priority"],
                no_feasible_route=result["no_feasible_route"],
                system_route_id=routes[chosen["system"]]["route_id"],
                cheapest_route_id=routes[chosen["always_cheapest"]]["route_id"],
                fastest_route_id=routes[chosen["always_fastest"]]["route_id"],
                safest_route_id=routes[chosen["always_safest"]]["route_id"],
                system_feasible=not result["no_feasible_route"],
                weight_stable=stable,
            ))

        def summarise(strategy: str) -> StrategySummary:
            rows = picks[strategy]
            return StrategySummary(
                strategy=strategy,
                sound_decision_rate=round(mean(r["sound"] for r in rows), 4),
                constraint_satisfaction_rate=round(mean(r["feasible"] for r in rows), 4),
                pareto_optimal_rate=round(mean(r["pareto"] for r in rows), 4),
                avg_freight_premium_pct=round(mean(r["freight_premium"] for r in rows), 2),
                avg_expected_cost_premium_pct=round(mean(r["expected_premium"] for r in rows), 2),
                avg_extra_days_vs_fastest=round(mean(r["extra_days"] for r in rows), 2),
                avg_delay_probability=round(mean(r["delay"] for r in rows), 4),
                avg_geopolitical_risk=round(mean(r["geo"] for r in rows), 4),
            )

        n = len(per_shipment)
        self._evaluation_cache = EvaluationResponse(
            n_shipments=n,
            no_feasible_route_count=no_feasible,
            weight_stability_rate=round(stable_count / n, 4) if n else 0.0,
            strategies=[summarise(k) for k in picks],
            shipments=per_shipment,
        )
        logger.info("Evaluation computed for %d shipments", n)
        return self._evaluation_cache


@lru_cache
def get_recommend_service() -> RecommendService:
    return RecommendService(get_shipment_service(), get_settings())


__all__ = ["RecommendService", "get_recommend_service", "WEIGHTS"]
