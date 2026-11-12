"""Pydantic schemas for recommendation, sensitivity and evaluation endpoints."""
from typing import Literal
from pydantic import BaseModel, Field, model_validator
from schemas.shipment_schema import Priority


class Weights(BaseModel):
    """Relative importance of each criterion. Any non-negative values are accepted
    and normalised to sum to 1 (e.g. {cost: 2, time: 1, risk: 1, delay: 0})."""

    cost: float = Field(ge=0, description="Expected total cost (freight + delay penalty + expected loss)")
    time: float = Field(ge=0, description="Expected transit days")
    risk: float = Field(ge=0, description="Risk index: 0.6 x geopolitical + 0.4 x congestion")
    delay: float = Field(ge=0, description="Probability of late arrival")

    @model_validator(mode="after")
    def _normalise(self) -> "Weights":
        total = self.cost + self.time + self.risk + self.delay
        if total <= 0:
            raise ValueError("at least one weight must be greater than 0")
        self.cost, self.time, self.risk, self.delay = (
            round(self.cost / total, 4), round(self.time / total, 4),
            round(self.risk / total, 4), round(self.delay / total, 4),
        )
        return self


class RecommendRequest(BaseModel):
    shipment_id: str = Field(min_length=1, max_length=32, examples=["SHP-008"])
    priority: Priority | None = Field(None, description="Override the shipment's priority profile")
    weights: Weights | None = Field(None, description="Custom weights; take precedence over priority")
    max_transit_days: float | None = Field(None, gt=0, description="Override the deadline")
    budget_usd: float | None = Field(None, gt=0, description="Override the budget")


class Constraints(BaseModel):
    max_transit_days: float
    budget_usd: float
    hazardous: bool


class RouteMetrics(BaseModel):
    expected_total_cost_usd: float
    expected_transit_days: float
    risk_index: float
    delay_probability: float


RouteStatus = Literal["recommended", "ranked", "dominated", "rejected"]


class RouteEvaluation(BaseModel):
    route_id: str
    route_name: str
    route_type: str
    carrier: str
    hubs_path: str
    total_cost_usd: float
    expected_transit_days: float
    on_time_reliability: float
    delay_probability: float
    geopolitical_risk: float
    congestion_risk: float
    co2_tonnes: float
    metrics: RouteMetrics
    status: RouteStatus
    feasible: bool
    pareto_optimal: bool | None
    score: float | None = Field(None, description="TOPSIS closeness to ideal, 0..1")
    rank: int | None
    rejected_reasons: list[str]


class RecommendationResponse(BaseModel):
    shipment_id: str
    priority: Priority
    weights: Weights
    constraints: Constraints
    recommended_route_id: str
    recommended_route_name: str
    no_feasible_route: bool
    explanation: str
    routes: list[RouteEvaluation]


class WeightScenario(BaseModel):
    name: str
    weights: Weights
    recommended_route_id: str
    same_as_base: bool


class MonteCarloResult(BaseModel):
    n_samples: int
    seed: int
    base_pick_win_rate: float
    route_win_rates: dict[str, float]


Verdict = Literal["stable", "moderately_stable", "sensitive"]


class SensitivityResponse(BaseModel):
    shipment_id: str
    base_route_id: str
    base_weights: Weights
    score_margin: float | None = Field(None, description="Score gap between #1 and #2 route")
    weight_delta: float
    weight_scenarios: list[WeightScenario]
    weight_stability: float
    monte_carlo: MonteCarloResult
    verdict: Verdict
    summary: str


Strategy = Literal["system", "always_cheapest", "always_fastest", "always_safest"]


class StrategySummary(BaseModel):
    strategy: Strategy
    sound_decision_rate: float = Field(
        description="Share of picks within limits and not beaten on every factor by another route within limits"
    )
    constraint_satisfaction_rate: float = Field(description="Share of picks meeting deadline, budget and cargo rules")
    pareto_optimal_rate: float = Field(description="Share of picks not dominated by another route")
    avg_freight_premium_pct: float = Field(description="Freight cost above the cheapest route, %")
    avg_expected_cost_premium_pct: float = Field(description="Risk-adjusted cost above the best possible, %")
    avg_extra_days_vs_fastest: float
    avg_delay_probability: float
    avg_geopolitical_risk: float


class ShipmentEvaluation(BaseModel):
    shipment_id: str
    priority: Priority
    no_feasible_route: bool
    system_route_id: str
    cheapest_route_id: str
    fastest_route_id: str
    safest_route_id: str
    system_feasible: bool
    weight_stable: bool


class EvaluationResponse(BaseModel):
    n_shipments: int
    no_feasible_route_count: int
    weight_stability_rate: float
    strategies: list[StrategySummary]
    shipments: list[ShipmentEvaluation]
