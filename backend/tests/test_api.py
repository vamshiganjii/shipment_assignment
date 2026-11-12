"""API tests against the real synthetic dataset."""
import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["shipments_loaded"] == 40


def test_list_and_get_shipment(client):
    items = client.get("/api/shipments").json()
    assert len(items) == 40
    detail = client.get(f"/api/shipments/{items[0]['shipment_id']}").json()
    assert 3 <= len(detail["routes"]) <= 5
    assert detail["routes"][0]["legs"]


def test_unknown_shipment_returns_404(client):
    for path in ("/api/shipments/NOPE", "/api/shipments/NOPE/recommend", "/api/shipments/NOPE/sensitivity"):
        r = client.get(path)
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "not_found"


def test_recommend_get(client):
    body = client.get("/api/shipments/SHP-008/recommend").json()
    statuses = [r["status"] for r in body["routes"]]
    assert statuses.count("recommended") == 1
    assert body["routes"][0]["route_id"] == body["recommended_route_id"]
    assert body["explanation"].startswith("Recommended")
    assert sum(body["weights"].values()) == pytest.approx(1.0, abs=1e-3)


def test_recommend_post_custom_weights_are_normalised(client):
    r = client.post("/api/recommend", json={
        "shipment_id": "SHP-008", "weights": {"cost": 0, "time": 2, "risk": 1, "delay": 1},
    })
    assert r.status_code == 200
    assert r.json()["weights"]["time"] == pytest.approx(0.5)


def test_recommend_post_overrides_constraints(client):
    r = client.post("/api/recommend", json={"shipment_id": "SHP-008", "budget_usd": 1})
    body = r.json()
    assert body["no_feasible_route"] is True
    assert body["constraints"]["budget_usd"] == 1


@pytest.mark.parametrize("payload", [
    {"shipment_id": "SHP-008", "weights": {"cost": 0, "time": 0, "risk": 0, "delay": 0}},
    {"shipment_id": "SHP-008", "weights": {"cost": -1, "time": 1, "risk": 1, "delay": 1}},
    {"shipment_id": "SHP-008", "priority": "fastest"},
    {"shipment_id": "SHP-008", "budget_usd": -5},
    {},
])
def test_recommend_post_validation(client, payload):
    assert client.post("/api/recommend", json=payload).status_code == 422


def test_sensitivity(client):
    body = client.get("/api/shipments/SHP-008/sensitivity", params={"n_samples": 100}).json()
    assert body["verdict"] in {"stable", "moderately_stable", "sensitive"}
    assert len(body["weight_scenarios"]) == 9
    assert sum(body["monte_carlo"]["route_win_rates"].values()) == pytest.approx(1.0, abs=1e-3)


def test_sensitivity_is_reproducible(client):
    a = client.get("/api/shipments/SHP-008/sensitivity", params={"n_samples": 100, "seed": 7}).json()
    b = client.get("/api/shipments/SHP-008/sensitivity", params={"n_samples": 100, "seed": 7}).json()
    assert a["monte_carlo"] == b["monte_carlo"]


def test_evaluate(client):
    body = client.get("/api/evaluate").json()
    assert body["n_shipments"] == 40
    strategies = {s["strategy"]: s for s in body["strategies"]}
    assert set(strategies) == {"system", "always_cheapest", "always_fastest", "always_safest"}
    # The system never picks a dominated route and satisfies constraints at least as often as baselines
    system = strategies["system"]
    assert system["pareto_optimal_rate"] == 1.0
    assert system["sound_decision_rate"] == 1.0
    assert all(system["sound_decision_rate"] >= s["sound_decision_rate"] for s in strategies.values())
    assert all(system["constraint_satisfaction_rate"] >= s["constraint_satisfaction_rate"]
               for s in strategies.values())
