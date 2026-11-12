"""Shipment data access: loads the dataset once and serves lookups from memory."""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from core.config import get_settings
from core.exceptions import DataLoadError, NotFoundError
from schemas.shipment_schema import ShipmentDetail, ShipmentSummary

logger = logging.getLogger(__name__)


class ShipmentService:
    def __init__(self, data_path: Path):
        self._data_path = data_path
        self._shipments: dict[str, dict[str, Any]] = self._load(data_path)

    @staticmethod
    def _load(path: Path) -> dict[str, dict[str, Any]]:
        try:
            with open(path, encoding="utf-8") as f:
                raw = json.load(f)["shipments"]
        except FileNotFoundError as e:
            raise DataLoadError(f"Dataset not found at {path}") from e
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            raise DataLoadError(f"Dataset at {path} is malformed: {e}") from e

        shipments: dict[str, dict[str, Any]] = {}
        for item in raw:
            try:
                ShipmentDetail.model_validate(item)  # fail fast on bad records
            except ValidationError as e:
                raise DataLoadError(
                    f"Invalid shipment record {item.get('shipment_id', '?')}: {e.error_count()} errors"
                ) from e
            shipments[item["shipment_id"]] = item
        logger.info("Loaded %d shipments from %s", len(shipments), path)
        return shipments

    def __len__(self) -> int:
        return len(self._shipments)

    # Raw dicts are used by the scoring engine
    def get_raw(self, shipment_id: str) -> dict[str, Any]:
        try:
            return self._shipments[shipment_id]
        except KeyError:
            raise NotFoundError(f"Shipment '{shipment_id}' not found") from None

    def all_raw(self) -> list[dict[str, Any]]:
        return list(self._shipments.values())

    # Typed schemas are returned by the API
    def list_shipments(self) -> list[ShipmentSummary]:
        return [ShipmentSummary.model_validate(s) for s in self._shipments.values()]

    def get_shipment(self, shipment_id: str) -> ShipmentDetail:
        return ShipmentDetail.model_validate(self.get_raw(shipment_id))


@lru_cache
def get_shipment_service() -> ShipmentService:
    """Singleton used as a FastAPI dependency (loaded once per process)."""
    return ShipmentService(get_settings().data_path)
