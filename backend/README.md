# Backend: Shipment Route Recommender API

## Run
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn main:app --reload        # http://127.0.0.1:8000/docs
pytest -q                        # 25 tests
```

## Configuration (environment variables)
| Variable | Default |
|---|---|
| `SHIPMENT_DATA_PATH` | `../data/dataset.json` |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` |
| `LOG_LEVEL` | `INFO` |

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness and the number of shipments loaded |
| GET | `/api/shipments` | List shipments |
| GET | `/api/shipments/{id}` | One shipment with its routes and legs |
| GET | `/api/shipments/{id}/recommend` | Recommendation using the shipment's own priority |
| POST | `/api/recommend` | Recommendation with custom `priority`, `weights`, `max_transit_days` or `budget_usd` |
| GET | `/api/shipments/{id}/sensitivity` | ±weight scenarios plus a Monte Carlo test of whether the pick holds |
| GET | `/api/evaluate` | System vs always-cheapest, always-fastest and always-safest baselines |
| GET | `/api/weights/presets` | Weight profile for each priority |

Errors always have this shape: `{"error": {"code": "...", "message": "..."}}`.

## Structure
```
core/        config, exceptions + handlers, logging
schemas/     Pydantic request/response schemas
services/    ShipmentService (data), RecommendService (use-cases)
  engine/    pure algorithm: scoring.py (filter → Pareto → TOPSIS), explain.py, uncertainty.py
api/         thin routers (HTTP only)
tests/       engine unit tests + API tests
```
