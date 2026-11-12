"""Unit tests for the pure scoring engine (no HTTP)."""
import pytest

from services.engine.scoring import dominates, normalize_weights, pareto_flags, recommend, topsis


def _route(rid, cost, days, geo=0.1, cong=0.3, delay=0.3, modes="sea"):
    return {
        "route_id": rid, "route_name": rid, "modes": modes,
        "total_cost_usd": cost, "expected_transit_days": days,
        "geopolitical_risk": geo, "congestion_risk": cong,
        "delay_probability": delay, "on_time_reliability": 1 - delay,
        "expected_delay_days": 2.0, "expected_loss_usd": 100.0,
    }


def _shipment(routes, priority="balanced", deadline=40, budget=10_000, hazardous=False):
    return {
        "shipment_id": "T-1", "priority": priority, "routes": routes,
        "max_transit_days": deadline, "budget_usd": budget,
        "late_penalty_usd_per_day": 100, "hazardous": hazardous,
    }


def test_normalize_weights_sums_to_one():
    w = normalize_weights({"cost": 2, "time": 1, "risk": 1, "delay": 0})
    assert sum(w.values()) == pytest.approx(1.0)
    assert w["cost"] == pytest.approx(0.5)


@pytest.mark.parametrize("bad", [{"cost": 0, "time": 0, "risk": 0, "delay": 0},
                                 {"cost": -1, "time": 1, "risk": 1, "delay": 1},
                                 {"cost": 1}])
def test_normalize_weights_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        normalize_weights(bad)


def test_dominance_and_pareto():
    a = {"cost": 1, "time": 1, "risk": 1, "delay": 1}
    b = {"cost": 2, "time": 2, "risk": 2, "delay": 2}
    c = {"cost": 0.5, "time": 3, "risk": 1, "delay": 1}
    assert dominates(a, b) and not dominates(b, a)
    assert pareto_flags([a, b, c]) == [True, False, True]


def test_topsis_prefers_ideal_route():
    good = {"cost": 1, "time": 1, "risk": 0.1, "delay": 0.1}
    bad = {"cost": 5, "time": 5, "risk": 0.9, "delay": 0.9}
    scores = topsis([good, bad], {"cost": 0.25, "time": 0.25, "risk": 0.25, "delay": 0.25})
    assert scores[0] == pytest.approx(1.0) and scores[1] == pytest.approx(0.0)


def test_infeasible_routes_are_rejected():
    s = _shipment([_route("ok", 5000, 30), _route("late", 4000, 50), _route("pricey", 20000, 10)])
    res = recommend(s)
    assert res["best"]["route"]["route_id"] == "ok"
    rejected = {x["route"]["route_id"]: x["rejected_reasons"] for x in res["others"]}
    assert "misses deadline" in rejected["late"][0]
    assert "over budget" in rejected["pricey"][0]


def test_hazardous_cargo_cannot_fly():
    s = _shipment([_route("sea", 5000, 30), _route("air", 6000, 2, modes="air")], hazardous=True)
    assert recommend(s)["best"]["route"]["route_id"] == "sea"


def test_priority_changes_the_pick():
    cheap_slow = _route("cheap", 3000, 38)
    fast_pricey = _route("fast", 9000, 12)
    s = _shipment([cheap_slow, fast_pricey])
    assert recommend({**s, "priority": "cost"})["best"]["route"]["route_id"] == "cheap"
    assert recommend({**s, "priority": "time"})["best"]["route"]["route_id"] == "fast"


def test_fallback_when_nothing_is_feasible():
    s = _shipment([_route("a", 50_000, 60), _route("b", 60_000, 70)])
    res = recommend(s)
    assert res["no_feasible_route"] is True
    assert res["best"]["route"]["route_id"] == "a"


def test_fallback_prefers_the_route_that_misses_limits_least():
    # Nothing meets a 2-day deadline; air misses it by 0.1 day, sea by 21 days.
    # Even a cost-first goal must pick the near-miss, not the cheap route that is weeks late.
    sea = _route("sea", 3000, 23)
    air = _route("air", 40_000, 2.1, modes="air")
    s = _shipment([sea, air], priority="cost", deadline=2, budget=1_000_000)
    res = recommend(s)
    assert res["no_feasible_route"] is True
    assert res["best"]["route"]["route_id"] == "air"
