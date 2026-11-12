"""
Synthetic shipment-route dataset generator (reproducible, seed 42).

Run with the backend's Python (it uses the backend scoring engine to check each shipment):
    ../backend/venv/Scripts/python generate_synthetic_data.py

Every shipment has 4-5 route options and its own deadline and budget, and is
re-drawn until "lowest cost", "fastest" and "lowest risk" each recommend a
different route (and "balanced" a fourth one where possible).

Produces (in this folder):
  shipments.csv  - one row per shipment (40 shipments)
  routes.csv     - one row per route option (4-5 per shipment)
  legs.csv       - one row per leg of each route
  hubs.csv       - port / hub / chokepoint reference with risk indicators
  dataset.json   - nested shipment -> routes -> legs (convenient system input)

Calibration (public 2026 benchmarks, see DATA_README.md):
  * Drewry WCI Apr-2026: Shanghai-Rotterdam ~$2,150/FEU, Shanghai-LA ~$2,930/FEU,
    Shanghai-NY ~$3,560/FEU, Shanghai-Genoa ~$3,070/FEU.
  * Sea-Intelligence GLP 2026: schedule reliability 56-62% (=> ~40% of sea
    arrivals late), average delay of late arrivals 5.2-6.1 days.
  * Cape of Good Hope diversion: +10-14 days vs Suez on Asia-Europe, ~15-25%
    more bunker; Red Sea / Hormuz carry high geopolitical risk in 2026.
"""
import csv
import json
import math
import random
import sys
from datetime import date, timedelta
from pathlib import Path

SEED = 42
N_SHIPMENTS = 40
OUT = Path(__file__).resolve().parent
rng = random.Random(SEED)
# Max war-risk surcharge per FEU on sea legs through conflict zones (scales with geo risk)
WAR_RISK_SURCHARGE_MAX = 300  # in line with 2026 carrier war-risk surcharges

# The generator checks each shipment with the real recommender, so every goal
# (lowest cost / fastest / lowest risk / balanced) leads to a different decision.
sys.path.insert(0, str(OUT.parent / "backend"))
from services.engine.scoring import WEIGHTS, check_feasibility, recommend  # noqa: E402

# --------------------------------------------------------------------------
# Hubs: congestion (0-1) and geopolitical risk (0-1) indicators
# --------------------------------------------------------------------------
HUBS = {
    # code: (name, country, type, congestion, geopolitical)
    "CNSHA": ("Shanghai", "China", "port", 0.55, 0.20),
    "CNYTN": ("Shenzhen Yantian", "China", "port", 0.40, 0.20),
    "CNCKG": ("Chongqing Rail Terminal", "China", "rail_hub", 0.25, 0.20),
    "VNSGN": ("Ho Chi Minh (Cat Lai)", "Vietnam", "port", 0.45, 0.10),
    "KRPUS": ("Busan", "South Korea", "port", 0.30, 0.15),
    "SGSIN": ("Singapore", "Singapore", "port", 0.45, 0.05),
    "LKCMB": ("Colombo", "Sri Lanka", "port", 0.40, 0.15),
    "INNSA": ("Nhava Sheva (Mumbai)", "India", "port", 0.50, 0.10),
    "INMAA": ("Chennai", "India", "port", 0.45, 0.10),
    "AEJEA": ("Jebel Ali (Dubai)", "UAE", "port", 0.35, 0.55),
    "AEDXB": ("Dubai Air Hub", "UAE", "air_hub", 0.20, 0.55),
    "XXBAB": ("Bab el-Mandeb / Red Sea", "-", "chokepoint", 0.30, 0.90),
    "XXHOR": ("Strait of Hormuz", "-", "chokepoint", 0.30, 0.80),
    "EGSUZ": ("Suez Canal", "Egypt", "chokepoint", 0.35, 0.60),
    "XXCGH": ("Cape of Good Hope", "-", "chokepoint", 0.10, 0.10),
    "PAPAN": ("Panama Canal", "Panama", "chokepoint", 0.50, 0.15),
    "KZKZ1": ("Kazakhstan-Russia Rail Corridor", "-", "rail_corridor", 0.35, 0.70),
    "NLRTM": ("Rotterdam", "Netherlands", "port", 0.40, 0.05),
    "DEHAM": ("Hamburg", "Germany", "port", 0.45, 0.05),
    "DEDUI": ("Duisburg Rail Terminal", "Germany", "rail_hub", 0.30, 0.05),
    "GBFXT": ("Felixstowe", "United Kingdom", "port", 0.40, 0.05),
    "ITGOA": ("Genoa", "Italy", "port", 0.35, 0.05),
    "USLAX": ("Los Angeles", "USA", "port", 0.40, 0.10),
    "USSEA": ("Seattle/Tacoma", "USA", "port", 0.25, 0.10),
    "USCHI": ("Chicago Rail Hub", "USA", "rail_hub", 0.35, 0.05),
    "USNYC": ("New York/New Jersey", "USA", "port", 0.40, 0.10),
    "USSAV": ("Savannah", "USA", "port", 0.35, 0.10),
    "MXLZC": ("Lazaro Cardenas", "Mexico", "port", 0.30, 0.40),
    "USORD": ("Chicago O'Hare Air Hub", "USA", "air_hub", 0.20, 0.05),
    "NLAMS": ("Amsterdam Schiphol Air Hub", "Netherlands", "air_hub", 0.20, 0.05),
}

# --------------------------------------------------------------------------
# Leg mode characteristics
#   base_delay_p: probability a leg runs late before hub/risk adjustments
#   late_mean   : mean delay (days) when late
# --------------------------------------------------------------------------
MODE = {
    "sea":   {"base_delay_p": 0.22, "late_mean": 5.5, "co2_g_per_tkm": 12},
    "rail":  {"base_delay_p": 0.15, "late_mean": 3.0, "co2_g_per_tkm": 25},
    "truck": {"base_delay_p": 0.08, "late_mean": 1.0, "co2_g_per_tkm": 80},
    "air":   {"base_delay_p": 0.06, "late_mean": 1.0, "co2_g_per_tkm": 600},
}

# --------------------------------------------------------------------------
# Lane route templates. Each leg: (from, to, mode, distance_km, days, usd_per_feu, via_chokepoints)
# usd_per_feu is the leg cost for one 40ft container (FEU) at base market level.
# --------------------------------------------------------------------------
LANES = {
    ("CNSHA", "NLRTM"): [
        ("Direct via Suez/Red Sea", "Ocean - Direct", [
            ("CNSHA", "NLRTM", "sea", 19500, 30, 1850, ["XXBAB", "EGSUZ"])]),
        ("Direct via Cape of Good Hope", "Ocean - Direct", [
            ("CNSHA", "NLRTM", "sea", 25000, 42, 2150, ["XXCGH"])]),
        ("Transship Singapore via Cape", "Ocean - Transshipment", [
            ("CNSHA", "SGSIN", "sea", 3800, 6, 450, []),
            ("SGSIN", "NLRTM", "sea", 21500, 36, 1550, ["XXCGH"])]),
        ("China-Europe Rail Express", "Rail", [
            ("CNSHA", "CNCKG", "truck", 1700, 2, 900, []),
            ("CNCKG", "DEDUI", "rail", 11000, 18, 6200, ["KZKZ1"]),
            ("DEDUI", "NLRTM", "truck", 230, 1, 650, [])]),
        ("Sea-Air via Dubai", "Sea-Air", [
            ("CNSHA", "AEJEA", "sea", 11000, 17, 1500, ["XXHOR"]),
            ("AEJEA", "AEDXB", "truck", 40, 1, 250, []),
            ("AEDXB", "NLAMS", "air", 5200, 2, 14500, []),
            ("NLAMS", "NLRTM", "truck", 70, 1, 350, [])]),
    ],
    ("CNSHA", "USLAX"): [
        ("Direct Transpacific", "Ocean - Direct", [
            ("CNSHA", "USLAX", "sea", 10500, 15, 2930, [])]),
        ("Transship Busan", "Ocean - Transshipment", [
            ("CNSHA", "KRPUS", "sea", 850, 2, 300, []),
            ("KRPUS", "USLAX", "sea", 9600, 13, 2350, [])]),
        ("Via Seattle + Rail/Truck", "Ocean + Land", [
            ("CNSHA", "USSEA", "sea", 9300, 13, 2600, []),
            ("USSEA", "USLAX", "truck", 1830, 3, 1900, [])]),
        ("Via Lazaro Cardenas + Truck", "Ocean + Land", [
            ("CNSHA", "MXLZC", "sea", 12000, 17, 2300, []),
            ("MXLZC", "USLAX", "truck", 3100, 5, 2100, [])]),
        ("Express Air Freight", "Air", [
            ("CNSHA", "USLAX", "air", 10500, 2, 38000, [])]),
    ],
    ("CNSHA", "USNYC"): [
        ("All-Water via Panama", "Ocean - Direct", [
            ("CNSHA", "USNYC", "sea", 19000, 34, 3560, ["PAPAN"])]),
        ("All-Water via Suez", "Ocean - Direct", [
            ("CNSHA", "USNYC", "sea", 22500, 37, 3300, ["XXBAB", "EGSUZ"])]),
        ("LA + Intermodal Rail via Chicago", "Ocean + Rail", [
            ("CNSHA", "USLAX", "sea", 10500, 15, 2930, []),
            ("USLAX", "USCHI", "rail", 3250, 4, 1700, []),
            ("USCHI", "USNYC", "rail", 1270, 3, 900, [])]),
        ("Transship Singapore via Cape to Savannah", "Ocean - Transshipment", [
            ("CNSHA", "SGSIN", "sea", 3800, 6, 450, []),
            ("SGSIN", "USSAV", "sea", 24500, 38, 2700, ["XXCGH"]),
            ("USSAV", "USNYC", "truck", 1300, 2, 1300, [])]),
    ],
    ("CNYTN", "GBFXT"): [
        ("Direct via Suez/Red Sea", "Ocean - Direct", [
            ("CNYTN", "GBFXT", "sea", 18500, 29, 1900, ["XXBAB", "EGSUZ"])]),
        ("Direct via Cape of Good Hope", "Ocean - Direct", [
            ("CNYTN", "GBFXT", "sea", 24000, 41, 2250, ["XXCGH"])]),
        ("Rotterdam + Feeder", "Ocean - Transshipment", [
            ("CNYTN", "NLRTM", "sea", 23800, 40, 2100, ["XXCGH"]),
            ("NLRTM", "GBFXT", "sea", 350, 2, 400, [])]),
        ("Sea-Air via Dubai", "Sea-Air", [
            ("CNYTN", "AEJEA", "sea", 10200, 16, 1450, ["XXHOR"]),
            ("AEJEA", "AEDXB", "truck", 40, 1, 250, []),
            ("AEDXB", "NLAMS", "air", 5200, 2, 14500, []),
            ("NLAMS", "GBFXT", "truck", 450, 2, 900, [])]),
    ],
    ("INNSA", "NLRTM"): [
        ("Direct via Suez/Red Sea", "Ocean - Direct", [
            ("INNSA", "NLRTM", "sea", 11500, 20, 1600, ["XXBAB", "EGSUZ"])]),
        ("Direct via Cape of Good Hope", "Ocean - Direct", [
            ("INNSA", "NLRTM", "sea", 18500, 32, 2000, ["XXCGH"])]),
        ("Transship Jebel Ali via Suez", "Ocean - Transshipment", [
            ("INNSA", "AEJEA", "sea", 1950, 4, 350, ["XXHOR"]),
            ("AEJEA", "NLRTM", "sea", 11800, 21, 1450, ["XXBAB", "EGSUZ"])]),
        ("Transship Colombo via Cape", "Ocean - Transshipment", [
            ("INNSA", "LKCMB", "sea", 1650, 3, 300, []),
            ("LKCMB", "NLRTM", "sea", 17800, 31, 1650, ["XXCGH"])]),
        ("Sea-Air via Dubai", "Sea-Air", [
            ("INNSA", "AEJEA", "sea", 1950, 4, 350, ["XXHOR"]),
            ("AEJEA", "AEDXB", "truck", 40, 1, 250, []),
            ("AEDXB", "NLAMS", "air", 5200, 2, 14500, []),
            ("NLAMS", "NLRTM", "truck", 70, 1, 350, [])]),
    ],
    ("SGSIN", "DEHAM"): [
        ("Direct via Suez/Red Sea", "Ocean - Direct", [
            ("SGSIN", "DEHAM", "sea", 15800, 25, 1750, ["XXBAB", "EGSUZ"])]),
        ("Direct via Cape of Good Hope", "Ocean - Direct", [
            ("SGSIN", "DEHAM", "sea", 21800, 37, 2050, ["XXCGH"])]),
        ("Rotterdam + Rail to Hamburg", "Ocean + Rail", [
            ("SGSIN", "NLRTM", "sea", 21500, 36, 1550, ["XXCGH"]),
            ("NLRTM", "DEHAM", "rail", 480, 2, 700, [])]),
        ("Express Air Freight", "Air", [
            ("SGSIN", "DEHAM", "air", 10300, 2, 36000, [])]),
        # Budget option: cheapest, but transships and still runs the Red Sea
        ("Transship Colombo via Suez", "Ocean - Transshipment", [
            ("SGSIN", "LKCMB", "sea", 2700, 4, 300, []),
            ("LKCMB", "DEHAM", "sea", 13500, 23, 800, ["XXBAB", "EGSUZ"])]),
    ],
    ("VNSGN", "USLAX"): [
        ("Direct Transpacific", "Ocean - Direct", [
            ("VNSGN", "USLAX", "sea", 13200, 20, 2750, [])]),
        # Transshipment undercuts the direct service on price, at the cost of reliability
        ("Transship Busan", "Ocean - Transshipment", [
            ("VNSGN", "KRPUS", "sea", 3600, 6, 450, []),
            ("KRPUS", "USLAX", "sea", 9600, 13, 1850, [])]),
        ("Express Air Freight", "Air", [
            ("VNSGN", "USLAX", "air", 13200, 2, 40000, [])]),
        ("Transship Shanghai", "Ocean - Transshipment", [
            ("VNSGN", "CNSHA", "sea", 2900, 5, 450, []),
            ("CNSHA", "USLAX", "sea", 10500, 15, 2500, [])]),
        ("Via Seattle + Truck", "Ocean + Land", [
            ("VNSGN", "USSEA", "sea", 12500, 19, 2500, []),
            ("USSEA", "USLAX", "truck", 1830, 3, 1900, [])]),
    ],
    ("INMAA", "USNYC"): [
        ("Direct via Suez/Red Sea", "Ocean - Direct", [
            ("INMAA", "USNYC", "sea", 16500, 28, 3100, ["XXBAB", "EGSUZ"])]),
        ("Direct via Cape of Good Hope", "Ocean - Direct", [
            ("INMAA", "USNYC", "sea", 19500, 35, 3350, ["XXCGH"])]),
        ("Transship Colombo via Cape to Savannah", "Ocean - Transshipment", [
            ("INMAA", "LKCMB", "sea", 750, 2, 250, []),
            ("LKCMB", "USSAV", "sea", 19000, 33, 2700, ["XXCGH"]),
            ("USSAV", "USNYC", "truck", 1300, 2, 1300, [])]),
        ("Transship Singapore via Transpacific + Rail", "Ocean + Rail", [
            ("INMAA", "SGSIN", "sea", 2900, 5, 450, []),
            ("SGSIN", "USLAX", "sea", 14100, 21, 2800, []),
            ("USLAX", "USCHI", "rail", 3250, 4, 1700, []),
            ("USCHI", "USNYC", "rail", 1270, 3, 900, [])]),
        ("Sea-Air via Dubai", "Sea-Air", [
            ("INMAA", "AEJEA", "sea", 3900, 7, 600, ["XXHOR"]),
            ("AEJEA", "AEDXB", "truck", 40, 1, 250, []),
            ("AEDXB", "USORD", "air", 12000, 2, 26000, []),
            ("USORD", "USNYC", "truck", 1270, 2, 1300, [])]),
    ],
}

CARGO_TYPES = {
    # type: (value_per_feu_usd range, weight_t per FEU range, perishable, hazardous)
    "general_merchandise": ((40_000, 90_000), (10, 18), False, False),
    "electronics":         ((250_000, 600_000), (6, 12), False, False),
    "automotive_parts":    ((80_000, 180_000), (14, 22), False, False),
    "apparel":             ((60_000, 140_000), (6, 10), False, False),
    "pharmaceuticals":     ((300_000, 900_000), (5, 10), True, False),
    "perishable_food":     ((30_000, 70_000), (16, 24), True, False),
    "chemicals":           ((50_000, 120_000), (18, 24), False, True),
    "machinery":           ((120_000, 300_000), (18, 26), False, False),
}
PRIORITIES = ["cost", "time", "balanced", "risk_averse"]
CARRIERS = ["Maersk", "MSC", "CMA CGM", "COSCO", "Hapag-Lloyd", "ONE", "Evergreen"]


def clip(x, lo, hi):
    return max(lo, min(hi, x))


def gen_leg(leg, market, season_cong):
    """Instantiate a leg template with per-shipment noise."""
    frm, to, mode, dist, days, cost, chokes = leg
    hubs = [frm, to] + chokes
    cong = clip(sum(HUBS[h][3] for h in hubs) / len(hubs) + season_cong + rng.gauss(0, 0.05), 0, 1)
    geo = max(HUBS[h][4] for h in hubs)
    geo = clip(geo + rng.gauss(0, 0.03), 0, 1)
    m = MODE[mode]
    # delay probability rises with congestion and geopolitical exposure
    geo_w = 0.15 if mode in ("sea", "rail") else 0.03  # war/security risk mostly hits sea & rail corridors
    delay_p = clip(m["base_delay_p"] + (0.25 if mode in ("sea", "rail") else 0.10) * cong + geo_w * geo + rng.gauss(0, 0.02), 0.02, 0.85)
    leg_days = max(1, round(days * rng.uniform(0.95, 1.08), 1))
    # war-risk / security surcharge on high-geo legs (USD per FEU)
    war_surcharge = round(WAR_RISK_SURCHARGE_MAX * max(0, geo - 0.5) * 2 * rng.uniform(0.8, 1.2)) if mode == "sea" else 0
    leg_cost = round(cost * market[mode] * rng.uniform(0.92, 1.10)) + war_surcharge
    return {
        "from_hub": frm, "to_hub": to, "mode": mode,
        "via_chokepoints": "|".join(chokes),
        "distance_km": dist,
        "transit_days": leg_days,
        "cost_usd_per_feu": leg_cost,
        "war_risk_surcharge_usd_per_feu": war_surcharge,
        "congestion_index": round(cong, 3),
        "geopolitical_risk": round(geo, 3),
        "delay_probability": round(delay_p, 3),
        "expected_delay_if_late_days": round(m["late_mean"] * (1 + cong) * rng.uniform(0.85, 1.15), 2),
    }


def aggregate_route(legs, n_feu, weight_t, cargo_value, ttype):
    n_trans = len(legs) - 1
    p_on_time = 1.0
    exp_delay = 0.0
    var = 0.0
    for lg in legs:
        p, d = lg["delay_probability"], lg["expected_delay_if_late_days"]
        p_on_time *= (1 - p)
        exp_delay += p * d
        var += p * (2 * d * d) - (p * d) ** 2  # exponential delay magnitude
    # each transshipment adds a missed-connection risk and 1.5 days dwell
    handling_p = 0.06 * n_trans
    p_delay = clip(1 - p_on_time * (1 - handling_p), 0, 0.95)
    dwell = 1.5 * n_trans
    base_days = sum(lg["transit_days"] for lg in legs) + dwell
    exp_delay += handling_p * 3.0
    cost_per_feu = sum(lg["cost_usd_per_feu"] for lg in legs) + 180 * n_trans  # handling fees
    total_cost = round(cost_per_feu * n_feu)
    cong = max(lg["congestion_index"] for lg in legs) * 0.5 + \
        sum(lg["congestion_index"] for lg in legs) / len(legs) * 0.5
    geo = max(lg["geopolitical_risk"] for lg in legs)
    co2 = sum(lg["distance_km"] * weight_t * MODE[lg["mode"]]["co2_g_per_tkm"] for lg in legs) / 1e6
    # cargo damage / loss risk: more handling + high-risk zones
    damage_p = clip(0.004 + 0.004 * n_trans + 0.01 * geo + (0.01 if ttype in ("perishable_food", "pharmaceuticals") and n_trans else 0), 0, 0.2)
    return {
        "num_legs": len(legs),
        "num_transshipments": n_trans,
        "modes": "+".join(dict.fromkeys(lg["mode"] for lg in legs)),
        "hubs_path": " > ".join([legs[0]["from_hub"]] + [lg["to_hub"] for lg in legs]),
        "chokepoints": "|".join(c for lg in legs for c in lg["via_chokepoints"].split("|") if c),
        "total_distance_km": sum(lg["distance_km"] for lg in legs),
        "cost_per_feu_usd": cost_per_feu,
        "total_cost_usd": total_cost,
        "transit_days_planned": round(base_days, 1),
        "transit_days_std": round(math.sqrt(max(var, 0)) + 0.5 * n_trans, 2),
        "delay_probability": round(p_delay, 3),
        "expected_delay_days": round(exp_delay, 2),
        "expected_transit_days": round(base_days + exp_delay, 1),
        "on_time_reliability": round(1 - p_delay, 3),
        "congestion_risk": round(cong, 3),
        "geopolitical_risk": round(geo, 3),
        "cargo_damage_probability": round(damage_p, 4),
        "co2_tonnes": round(co2, 2),
        "expected_loss_usd": round(cargo_value * damage_p),
    }


GOALS = ("cost", "time", "risk_averse", "balanced")
MAX_ATTEMPTS = 2000



def goal_picks(ship: dict, route_records: list[dict]) -> tuple[dict[str, str], int]:
    """Run the real recommender for every goal; return the pick per goal and #feasible routes."""
    s = {**ship, "routes": [r["_nested"] for r in route_records]}
    picks = {g: recommend(s, WEIGHTS[g])["best"]["route"]["route_id"] for g in GOALS}
    feasible = sum(not check_feasibility(r, s) for r in s["routes"])
    return picks, feasible


def is_good(picks: dict[str, str], feasible: int, need_four: bool) -> bool:
    """Lowest cost, Fastest and Lowest risk must each pick a different route
    (and Balanced a fourth one when need_four), with >= 3 routes inside the limits."""
    core = {picks["cost"], picks["time"], picks["risk_averse"]}
    if feasible < 3 or len(core) < 3:
        return False
    return not need_four or picks["balanced"] not in core


def main():
    lanes = list(LANES.keys())
    shipments, routes, legs_out, nested = [], [], [], []
    four_way = 0

    for i in range(N_SHIPMENTS):
        sid = f"SHP-{i + 1:03d}"
        lane = lanes[i % len(lanes)]  # 5 shipments per lane
        # Re-draw the shipment until every goal leads to a different decision.
        # Prefer all four goals distinct; fall back to the three single-objective goals.
        fallback = None
        for attempt in range(MAX_ATTEMPTS):
            ship, records, legs = make_shipment(sid, lane)
            picks, feasible = goal_picks(ship, records)
            if is_good(picks, feasible, need_four=True):
                four_way += 1
                break
            if fallback is None and is_good(picks, feasible, need_four=False):
                fallback = (ship, records, legs)
        else:
            if fallback is None:
                raise RuntimeError(f"{sid}: could not build a shipment with distinct goal picks")
            ship, records, legs = fallback

        shipments.append(ship)
        legs_out.extend(legs)
        nested_routes = []
        for r in records:
            nested_routes.append(r.pop("_nested"))
            r["meets_deadline"] = r["expected_transit_days"] <= ship["max_transit_days"]
            r["within_budget"] = r["total_cost_usd"] <= ship["budget_usd"]
            nested_routes[-1]["meets_deadline"] = r["meets_deadline"]
            nested_routes[-1]["within_budget"] = r["within_budget"]
            routes.append(r)
        nested.append({**ship, "routes": nested_routes})

    def write(name, rows):
        with open(OUT / name, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    write("shipments.csv", shipments)
    write("routes.csv", routes)
    write("legs.csv", legs_out)
    write("hubs.csv", [{"hub_code": k, "name": v[0], "country": v[1], "type": v[2],
                        "congestion_index": v[3], "geopolitical_risk": v[4]} for k, v in HUBS.items()])
    with open(OUT / "dataset.json", "w", encoding="utf-8") as f:
        json.dump({"seed": SEED, "shipments": nested}, f, indent=2)

    print(f"shipments={len(shipments)} routes={len(routes)} legs={len(legs_out)} hubs={len(HUBS)}")
    print(f"all 4 goals distinct: {four_way}/{len(shipments)}; "
          f"cost/time/risk distinct: {len(shipments)}/{len(shipments)}")


def make_shipment(sid: str, lane: tuple[str, str]) -> tuple[dict, list[dict], list[dict]]:
    """Draw one shipment with 4-5 route options and per-shipment deadline/budget."""
    origin, dest = lane
    start = date(2026, 11, 16)
    ttype = rng.choice(list(CARGO_TYPES))
    (vlo, vhi), (wlo, whi), perishable, hazardous = CARGO_TYPES[ttype]
    n_feu = rng.choice([1, 1, 2, 2, 3, 4, 5, 8, 10])
    weight_t = round(n_feu * rng.uniform(wlo, whi), 1)
    value = round(n_feu * rng.uniform(vlo, vhi), -2)
    ship_date = start + timedelta(days=rng.randint(0, 60))
    # peak / pre-Lunar-New-Year season (late Jan-Feb 2027) raises congestion & prices
    peak = date(2027, 1, 10) <= ship_date <= date(2027, 2, 15)
    season_cong = 0.08 if peak else 0.0
    market = {
        "sea": rng.uniform(0.85, 1.20) * (1.10 if peak else 1.0),
        "rail": rng.uniform(0.90, 1.10),
        "truck": rng.uniform(0.95, 1.10),
        "air": rng.uniform(0.85, 1.25),
    }
    priority = "time" if perishable and rng.random() < 0.6 else rng.choice(PRIORITIES)

    templates = LANES[(origin, dest)]
    k = min(len(templates), rng.choice([4, 5]))  # every shipment gets 4-5 options
    chosen = rng.sample(templates, k)

    legs_out: list[dict] = []
    route_records = []
    for j, (rname, rtype, legs_t) in enumerate(chosen):
        rid = f"{sid}-R{j + 1}"
        carrier = rng.choice(CARRIERS)
        legs = [gen_leg(lt, market, season_cong) for lt in legs_t]
        if hazardous and any(l["mode"] == "air" for l in legs):
            # dangerous-goods air surcharge
            for l in legs:
                if l["mode"] == "air":
                    l["cost_usd_per_feu"] = round(l["cost_usd_per_feu"] * 1.35)
        agg = aggregate_route(legs, n_feu, weight_t, value, ttype)
        rec = {"route_id": rid, "shipment_id": sid, "route_name": rname,
               "route_type": rtype, "carrier": carrier, **agg}
        route_records.append(rec)
        for n, lg in enumerate(legs, 1):
            legs_out.append({"route_id": rid, "shipment_id": sid, "leg_seq": n, **lg})
        nested_route = dict(rec)
        nested_route["legs"] = legs
        rec["_nested"] = nested_route

    # Per-shipment limits. Each is either loose (every route fits) or cuts the single
    # most extreme route (priciest / slowest), so the constraint check still matters.
    exp_times = sorted(r["expected_transit_days"] for r in route_records)
    costs = sorted(r["total_cost_usd"] for r in route_records)
    if rng.random() < 0.5:
        budget = costs[-1] * rng.uniform(1.03, 1.25)                      # all routes affordable
    else:
        budget = costs[-2] + (costs[-1] - costs[-2]) * rng.uniform(0.2, 0.8)  # priciest is over budget
    if rng.random() < 0.5:
        deadline = exp_times[-1] * rng.uniform(1.03, 1.15)                # all routes on time
    else:
        deadline = exp_times[-2] + (exp_times[-1] - exp_times[-2]) * rng.uniform(0.2, 0.8)  # slowest is late
    deadline = max(round(deadline), math.ceil(exp_times[-2]))
    budget = max(round(budget, -2), math.ceil(costs[-2] / 100) * 100)

    ship = {
        "shipment_id": sid,
        "origin": origin, "origin_name": HUBS[origin][0],
        "destination": dest, "destination_name": HUBS[dest][0],
        "ship_date": ship_date.isoformat(),
        "required_delivery_date": (ship_date + timedelta(days=deadline)).isoformat(),
        "max_transit_days": deadline,
        "cargo_type": ttype,
        "perishable": perishable, "hazardous": hazardous,
        "containers_feu": n_feu, "weight_tonnes": weight_t,
        "cargo_value_usd": value,
        "budget_usd": budget,
        "priority": priority,
        "late_penalty_usd_per_day": round(value * (0.004 if perishable else 0.0015)),
        "peak_season": peak,
        "num_route_options": len(route_records),
    }
    return ship, route_records, legs_out


if __name__ == "__main__":
    main()
