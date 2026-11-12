"""Pydantic schemas for shipments, routes and legs."""
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict

Priority = Literal["cost", "time", "balanced", "risk_averse"]


class _Schema(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Leg(_Schema):
    leg_seq: int | None = None
    from_hub: str
    to_hub: str
    mode: Literal["sea", "rail", "truck", "air"]
    via_chokepoints: str
    distance_km: float
    transit_days: float
    cost_usd_per_feu: float
    war_risk_surcharge_usd_per_feu: float
    congestion_index: float
    geopolitical_risk: float
    delay_probability: float
    expected_delay_if_late_days: float


class Route(_Schema):
    route_id: str
    route_name: str
    route_type: str
    carrier: str
    num_legs: int
    num_transshipments: int
    modes: str
    hubs_path: str
    chokepoints: str
    total_distance_km: float
    cost_per_feu_usd: float
    total_cost_usd: float
    transit_days_planned: float
    transit_days_std: float
    delay_probability: float
    expected_delay_days: float
    expected_transit_days: float
    on_time_reliability: float
    congestion_risk: float
    geopolitical_risk: float
    cargo_damage_probability: float
    co2_tonnes: float
    expected_loss_usd: float
    meets_deadline: bool
    within_budget: bool
    legs: list[Leg]


class ShipmentSummary(_Schema):
    shipment_id: str
    origin: str
    origin_name: str
    destination: str
    destination_name: str
    ship_date: date
    cargo_type: str
    priority: Priority
    containers_feu: int
    cargo_value_usd: float
    num_route_options: int


class ShipmentDetail(ShipmentSummary):
    required_delivery_date: date
    max_transit_days: float
    perishable: bool
    hazardous: bool
    weight_tonnes: float
    budget_usd: float
    late_penalty_usd_per_day: float
    peak_season: bool
    routes: list[Route]
