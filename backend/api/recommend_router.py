from typing import Annotated

from fastapi import APIRouter, Depends, Query

from api.deps import NOT_FOUND, ShipmentId
from schemas.recommend_schema import (
    EvaluationResponse, RecommendationResponse, RecommendRequest, SensitivityResponse, Weights,
)
from services.engine.scoring import WEIGHTS
from services.recommend_service import RecommendService, get_recommend_service

router = APIRouter(tags=["recommendation"])

Service = Annotated[RecommendService, Depends(get_recommend_service)]


@router.get(
    "/weights/presets",
    response_model=dict[str, Weights],
    summary="Weight profile used for each shipment priority",
)
def weight_presets() -> dict[str, Weights]:
    return {name: Weights(**w) for name, w in WEIGHTS.items()}


@router.get(
    "/shipments/{shipment_id}/recommend",
    response_model=RecommendationResponse,
    summary="Recommend a route using the shipment's own priority",
    responses=NOT_FOUND,
)
def recommend_for_shipment(shipment_id: ShipmentId, service: Service) -> RecommendationResponse:
    return service.recommend(shipment_id)


@router.post(
    "/recommend",
    response_model=RecommendationResponse,
    summary="Recommend a route with custom priority, weights or constraints",
    responses=NOT_FOUND,
)
def recommend_custom(body: RecommendRequest, service: Service) -> RecommendationResponse:
    return service.recommend(
        body.shipment_id,
        priority=body.priority,
        weights=body.weights,
        max_transit_days=body.max_transit_days,
        budget_usd=body.budget_usd,
    )


@router.get(
    "/shipments/{shipment_id}/sensitivity",
    response_model=SensitivityResponse,
    summary="Check whether the recommendation holds under weight changes and data uncertainty",
    responses=NOT_FOUND,
)
def sensitivity(
    shipment_id: ShipmentId,
    service: Service,
    delta: Annotated[float, Query(gt=0, le=0.9, description="Relative weight change, e.g. 0.2 = ±20%")] = 0.2,
    n_samples: Annotated[int, Query(ge=50, le=2000, description="Monte Carlo samples")] = 300,
    seed: Annotated[int, Query(ge=0, description="Random seed for reproducibility")] = 42,
) -> SensitivityResponse:
    return service.sensitivity(shipment_id, delta=delta, n_samples=n_samples, seed=seed)


@router.get(
    "/evaluate",
    response_model=EvaluationResponse,
    summary="Evaluate the system against cheapest / fastest / safest baselines on all shipments",
)
def evaluate(service: Service) -> EvaluationResponse:
    return service.evaluate()
