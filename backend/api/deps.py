"""Path parameters and response docs shared by several routers."""
from typing import Annotated

from fastapi import Path

ShipmentId = Annotated[str, Path(min_length=1, max_length=32, examples=["SHP-008"])]
NOT_FOUND = {404: {"description": "Shipment not found"}}
