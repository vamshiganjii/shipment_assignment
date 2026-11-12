# Synthetic Shipment Route Dataset

Reproducible (`seed=42`). Run it with the backend's Python, because it uses the backend scoring engine to check each shipment (about 1 minute):

```bash
cd data
../backend/venv/Scripts/python generate_synthetic_data.py
```

## Files

| File | Grain | Rows |
|---|---|---|
| `shipments.csv` | one shipment (input to the recommender) | 40 |
| `routes.csv` | one route option per shipment (4–5 each) | 176 |
| `legs.csv` | one leg of a route | 343 |
| `hubs.csv` | port / hub / chokepoint risk reference | 30 |
| `dataset.json` | nested shipment → routes → legs | – |

## Key fields

**Shipment:** `origin`, `destination`, `ship_date`, `max_transit_days` (deadline), `cargo_type`, `perishable`, `hazardous`, `containers_feu`, `weight_tonnes`, `cargo_value_usd`, `budget_usd`, `priority` (`cost` / `time` / `balanced` / `risk_averse`), `late_penalty_usd_per_day`, `peak_season`.

**Route:** `hubs_path`, `chokepoints`, `modes`, `num_transshipments`, `total_cost_usd`, `transit_days_planned`, `transit_days_std`, `delay_probability`, `expected_delay_days`, `expected_transit_days`, `on_time_reliability`, `congestion_risk`, `geopolitical_risk`, `cargo_damage_probability`, `expected_loss_usd`, `co2_tonnes`, `meets_deadline`, `within_budget`.

## How routes and trade-offs were constructed

1. **8 real trade lanes** (Shanghai→Rotterdam, Shanghai→Los Angeles, Shanghai→New York, Yantian→Felixstowe, Nhava Sheva→Rotterdam, Singapore→Hamburg, Ho Chi Minh→Los Angeles, Chennai→New York). Each lane has 4–5 route templates: direct ocean via Suez/Red Sea, direct ocean via the Cape of Good Hope, transshipment, ocean + rail/truck, China–Europe rail, sea-air via Dubai, or air. Every lane includes at least one budget option, one fast option and one low-risk option, so each lane has a real trade-off.
2. **Base cost and time per leg** are calibrated to public 2026 benchmarks:
   - Drewry World Container Index (Apr 2026): Shanghai→Rotterdam ≈ $2,150/FEU, →Los Angeles ≈ $2,930, →New York ≈ $3,560, →Genoa ≈ $3,070.
   - Rerouting via the Cape adds about 10–14 days on Asia–Europe lanes and about 15–25% more fuel.
   - Air freight is costed at about $3–5/kg (about $36–38k per FEU-equivalent).
3. **Risk indicators.** Each hub or chokepoint has a congestion index and a geopolitical risk score (0–1). For example, Bab el-Mandeb/Red Sea is 0.90, Hormuz is 0.80, the Kazakhstan–Russia rail corridor is 0.70, Panama has congestion 0.50 (drought draft limits), and the Cape is 0.10. A leg takes the mean congestion and the maximum geopolitical risk of the hubs it touches.
4. **Delay model.** Leg delay probability = mode base + congestion term + geopolitical term (sea and rail are most exposed). For a whole route, P(late) = 1 − ∏(1 − pᵢ), plus 6% missed-connection risk per transshipment. Expected delay = Σ pᵢ·(mean delay when late). The result matches Sea-Intelligence 2026 figures: about 56–62% schedule reliability (≈ 40% of direct sea arrivals late) and an average delay of 5.2–6.1 days for late arrivals.
5. **Built-in trade-offs.**
   - Suez is cheaper and faster but carries high geopolitical risk plus a war-risk surcharge (up to $300/FEU, scaled by risk).
   - The Cape is slower and costlier but safe.
   - Transshipment is cheaper but less reliable (budget services through Colombo or Busan undercut direct sailings by about 30%).
   - Air is fast and reliable but costs 10–15× more and emits far more CO₂.
   - Rail is mid-speed but runs through a sanctions-risk corridor.
6. **Per-shipment noise.** Each shipment draws a market multiplier (±15%), adds a peak-season uplift (Lunar New Year: +10% price, +0.08 congestion), applies ±5–10% leg-level jitter, and picks 4–5 of the lane's templates. The same lane therefore yields different trade-offs.
7. **Constraints (set per shipment).**
   - Budget: either every route fits (budget = priciest route × 1.03–1.25) or only the priciest is over budget (budget between the 2nd-priciest and priciest route). Each is chosen with 50% probability.
   - Deadline: either every route is on time (slowest route × 1.03–1.15) or only the slowest is late (between the 2nd-slowest and slowest). Each is chosen with 50% probability.
   - So one extreme route is often ruled out, which keeps the constraint check visible, while 3–5 routes always remain feasible.
8. **Every goal leads to a different decision.** Each shipment is re-drawn (up to 2,000 attempts) until the real recommender picks a **different route for "Lowest cost", "Fastest" and "Lowest risk"**, with at least 3 routes inside the limits.
   - Result: 40/40 shipments give three distinct picks, and 10/40 also give a fourth distinct pick for "Balanced". Balanced is a compromise, so it often matches one of the others.
   - This is a deliberate scenario-selection step. The dataset represents shipments where the trade-off is real, which is the case a decision-support tool exists for. Where one route wins on everything, no tool is needed.

## Assumptions and limitations
- Costs are per 40ft container (FEU) and scale linearly with container count. There are no volume discounts.
- Leg delays are treated as independent, so correlated disruptions such as a canal closure are not modelled.
- Risk scores are expert-assigned heuristics, not measured data.
- Spot rates are a 2026 snapshot. Real rates change weekly.
- Scenario selection (step 8) biases the dataset toward genuine trade-offs, so it is not a random sample of all shipments. In real data, one route would often dominate.

## Sources
- Drewry WCI, Apr 2026 (via gCaptain / AJOT): https://gcaptain.com/transpacific-defies-downtrend-as-container-spot-rates-climb-on-war-driven-demand/
- Sea-Intelligence Global Liner Performance 2026: https://sea-intelligence.com/press-room/400-global-schedule-reliability-drops-to-62-6-in-june-2026
- Red Sea / Cape routing impact 2026: https://www.searates.com/blog/post/suez-canal-and-red-sea-shipping-in-2026-risks-routes-and-operational-impact , https://gofreight.com/blog/maritime-disruption
