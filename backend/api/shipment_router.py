from typing import Annotated

from fastapi import APIRouter, Depends

from api.deps import NOT_FOUND, ShipmentId
from schemas.shipment_schema import ShipmentDetail, ShipmentSummary
from services.shipment_service import ShipmentService, get_shipment_service

router = APIRouter(prefix="/shipments", tags=["shipments"])

Service = Annotated[ShipmentService, Depends(get_shipment_service)]


@router.get("", response_model=list[ShipmentSummary], summary="List all shipments")
def list_shipments(service: Service) -> list[ShipmentSummary]:
    return service.list_shipments()


@router.get(
    "/{shipment_id}",
    response_model=ShipmentDetail,
    summary="Get one shipment with all route options and legs",
    responses=NOT_FOUND,
)
def get_shipment(shipment_id: ShipmentId, service: Service) -> ShipmentDetail:
    return service.get_shipment(shipment_id)
