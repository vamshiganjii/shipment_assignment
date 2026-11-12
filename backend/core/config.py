"""Application settings, read from environment variables with safe defaults."""
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_PATH = BACKEND_DIR.parent / "data" / "dataset.json"


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str = "Shipment Route Recommender"
    version: str = "1.0.0"
    data_path: Path = field(
        default_factory=lambda: Path(os.getenv("SHIPMENT_DATA_PATH", str(DEFAULT_DATA_PATH)))
    )
    cors_origins: list[str] = field(
        default_factory=lambda: _split_csv(
            os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
        )
    )
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO").upper())
    # Sensitivity analysis defaults
    sensitivity_delta: float = 0.20          # +/-20% weight perturbation
    monte_carlo_samples: int = 300
    monte_carlo_seed: int = 42


@lru_cache
def get_settings() -> Settings:
    return Settings()
