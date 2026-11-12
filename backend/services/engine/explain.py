def _compare(b, o):
    gains, costs = [], []
    dc = o["total_cost_usd"] - b["total_cost_usd"]
    dt = o["expected_transit_days"] - b["expected_transit_days"]
    dd = o["delay_probability"] - b["delay_probability"]
    dg = o["geopolitical_risk"] - b["geopolitical_risk"]
    if abs(dc) >= 50:
        (gains if dc > 0 else costs).append(f"${abs(dc):,.0f} {'cheaper' if dc > 0 else 'more expensive'}")
    if abs(dt) >= 0.5:
        (gains if dt > 0 else costs).append(f"{abs(dt):.1f} days {'faster' if dt > 0 else 'slower'}")
    if abs(dd) >= 0.03:
        (gains if dd > 0 else costs).append(f"delay risk {b['delay_probability']:.0%} vs {o['delay_probability']:.0%}")
    if abs(dg) >= 0.1:
        (gains if dg > 0 else costs).append(f"geopolitical risk {b['geopolitical_risk']:.2f} vs {o['geopolitical_risk']:.2f}")
    return gains, costs


def explain(shipment, result):
    best = result["best"]
    b = best["route"]
    parts = [f"Recommended '{b['route_name']}' for a {shipment['priority'].replace('_', '-')} shipment: "
             f"${b['total_cost_usd']:,.0f}, ~{b['expected_transit_days']} days, "
             f"{b['on_time_reliability']:.0%} on-time."]

    if len(result["ranked"]) > 1:
        o = result["ranked"][1]["route"]
        gains, costs = _compare(b, o)
        s = f"Versus the runner-up '{o['route_name']}', it is " + (", ".join(gains) or "similar overall")
        if costs:
            s += f", at the price of being {', '.join(costs)}"
        parts.append(s + f" (score {best['score']:.2f} vs {result['ranked'][1]['score']:.2f}).")

    for x in result["others"]:
        name = x["route"]["route_name"]
        if x["rejected_reasons"]:
            parts.append(f"'{name}' rejected: {'; '.join(x['rejected_reasons'])}.")
        elif not x.get("pareto_optimal", True):
            parts.append(f"'{name}' dropped: another route is better or equal on cost, time and risk.")

    if result["no_feasible_route"]:
        parts.append("WARNING: no route meets all constraints; this is the least-bad option"
                     + (f" ({'; '.join(best['rejected_reasons'])})." if best["rejected_reasons"] else "."))
    return " ".join(parts)
