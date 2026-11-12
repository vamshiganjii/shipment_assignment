"""HTTP layer: every router is registered here, so main.py includes a single router."""
from fastapi import APIRouter

from api.recommend_router import router as recommend_router
from api.shipment_router import router as shipment_router

api_router = APIRouter(prefix="/api")
api_router.include_router(shipment_router)
api_router.include_router(recommend_router)

__all__ = ["api_router"]
