import type { Priority, Recommendation, RouteEvaluation, Verdict } from "@/lib/api"
import { fmtUsd } from "@/lib/format"

export const GOALS: { value: Priority; label: string; hint: string }[] = [
  { value: "cost", label: "Lowest cost", hint: "Save money, accept some delay" },
  { value: "time", label: "Fastest", hint: "Arrive as early as possible" },
  { value: "risk_averse", label: "Lowest risk", hint: "Avoid conflict zones and congested ports" },
  { value: "balanced", label: "Balanced", hint: "A fair mix of everything" },
]

export type RiskLevel = "Low" | "Medium" | "High"

export function riskLevel(geo: number): RiskLevel {
  if (geo < 0.3) return "Low"
  if (geo < 0.6) return "Medium"
  return "High"
}

export const RISK_COLOR: Record<RiskLevel, string> = {
  Low: "var(--status-good)",
  Medium: "var(--status-warning)",
  High: "var(--status-critical)",
}

export function verdict(r: RouteEvaluation, rec: Recommendation): { label: string; tone: "best" | "ok" | "bad" } {
  if (r.status === "recommended") {
    return rec.no_feasible_route ? { label: "Least-bad option", tone: "best" } : { label: "Best choice", tone: "best" }
  }
  if (r.status === "ranked") return { label: "Good alternative", tone: "ok" }
  if (r.rejected_reasons.length) {
    const parts = r.rejected_reasons.map((x) =>
      x.startsWith("misses deadline") ? "Too slow" : x.startsWith("over budget") ? "Over budget" : "Not allowed for hazardous cargo",
    )
    return { label: parts.join(" · "), tone: "bad" }
  }
  return { label: "Beaten by another option", tone: "bad" }
}

/** Tags like "Cheapest" / "Fastest" / "Safest" across all options. */
export function bestAtTags(routes: RouteEvaluation[]): Record<string, string[]> {
  const tags: Record<string, string[]> = {}
  const add = (id: string, t: string) => (tags[id] ??= []).push(t)
  const by = (f: (r: RouteEvaluation) => number) => routes.reduce((a, b) => (f(b) < f(a) ? b : a))
  const cheapest = by((r) => r.total_cost_usd)
  const bestValue = by((r) => r.metrics.expected_total_cost_usd)
  add(cheapest.route_id, "Cheapest")
  // Lowest total cost once expected delay/damage costs are added; only shown when it differs from the cheapest price
  if (bestValue.route_id !== cheapest.route_id) add(bestValue.route_id, "Best value")
  add(by((r) => r.expected_transit_days).route_id, "Fastest")
  add(by((r) => r.metrics.risk_index).route_id, "Safest")
  return tags
}

export function reasons(rec: Recommendation): string[] {
  const routes = rec.routes
  const best = routes.find((r) => r.status === "recommended")!
  const out: string[] = []
  const allTags = bestAtTags(routes)
  const tags = allTags[best.route_id] ?? []
  const simpleTags = tags.filter((t) => t !== "Best value")
  const feasible = routes.filter((r) => r.feasible)

  if (rec.no_feasible_route) {
    out.push("No option meets both the deadline and the budget, so this is the closest fit.")
  } else if (feasible.length === 1) {
    out.push("It is the only option that meets both your deadline and your budget.")
  } else if (tags.includes("Best value")) {
    const cheapest = routes.find((r) => allTags[r.route_id]?.includes("Cheapest"))
    out.push(
      `It has the lowest total cost once the expected cost of delays and damage is added` +
        (cheapest
          ? `. “${cheapest.route_name}” has a lower price, but is late ${Math.round(cheapest.delay_probability * 100)}% of the time.`
          : "."),
    )
    if (simpleTags.length) out.push(`It is also the ${joinAnd(simpleTags.map((t) => t.toLowerCase()))} of all options.`)
  } else if (simpleTags.length) {
    out.push(`It is the ${joinAnd(simpleTags.map((t) => t.toLowerCase()))} of all options.`)
  } else {
    out.push(`It meets your deadline and budget with the best overall balance for “${goalLabel(rec.priority)}”.`)
  }

  const runnerUp = routes.find((r) => r.rank === 2)
  if (runnerUp) {
    const diffs: string[] = []
    const dc = runnerUp.total_cost_usd - best.total_cost_usd
    const dd = runnerUp.expected_transit_days - best.expected_transit_days
    if (Math.abs(dc) >= 50) diffs.push(dc > 0 ? `saves ${fmtUsd(dc)}` : `costs ${fmtUsd(-dc)} more`)
    if (Math.abs(dd) >= 0.5) diffs.push(dd > 0 ? `arrives ${dd.toFixed(0)} days sooner` : `takes ${(-dd).toFixed(0)} days longer`)
    const rb = riskLevel(best.geopolitical_risk)
    const rr = riskLevel(runnerUp.geopolitical_risk)
    if (rb !== rr) diffs.push(`has ${rb.toLowerCase()} instead of ${rr.toLowerCase()} risk`)
    const ob = Math.round(best.on_time_reliability * 100)
    const or = Math.round(runnerUp.on_time_reliability * 100)
    if (Math.abs(ob - or) >= 3) diffs.push(`${ob}% vs ${or}% chance of arriving on time`)
    if (diffs.length) out.push(`Compared with “${runnerUp.route_name}”, it ${joinAnd(diffs)}.`)
  }

  const rejected = routes.filter((r) => r.status === "rejected")
  const safer = rejected.filter((r) => r.metrics.risk_index < best.metrics.risk_index)
  if (riskLevel(best.geopolitical_risk) === "High" && safer.length) {
    out.push(
      `Watch out: this route passes a high-risk area. Safer options exist, but they are ${joinAnd(
        [...new Set(safer.map((r) => verdict(r, rec).label.toLowerCase()))],
      )}. Raise the budget or deadline under “Fine-tune” to see them.`,
    )
  } else if (rejected.length && feasible.length) {
    const n = rejected.length
    out.push(`${n} other option${n > 1 ? "s were" : " was"} ruled out for missing the deadline or budget.`)
  }
  return out
}

export const CONFIDENCE: Record<Verdict, { label: string; color: string }> = {
  stable: { label: "High", color: "var(--status-good)" },
  moderately_stable: { label: "Medium", color: "var(--status-warning)" },
  sensitive: { label: "Low", color: "var(--status-critical)" },
}

export const goalLabel = (p: Priority) => GOALS.find((g) => g.value === p)?.label ?? p

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/**
 * When the limits leave 0 or 1 routes, explain it and say exactly what to change to get choices back.
 * Returns null when 2+ routes fit (the goals then have something to choose between).
 */
export function limitsHint(routes: RouteEvaluation[], maxDays: number, budget: number): string | null {
  const fits = routes.filter((r) => r.feasible)
  if (fits.length > 1) return null
  const miss = (r: RouteEvaluation) =>
    Math.max(0, r.expected_transit_days - maxDays) / maxDays + Math.max(0, r.total_cost_usd - budget) / budget
  const fixable = routes
    .filter((r) => !r.feasible && !r.rejected_reasons.some((x) => x.startsWith("hazardous")))
    .sort((a, b) => miss(a) - miss(b))
  const next = fixable[0]

  const howToFit = (r: RouteEvaluation) => {
    const facts: string[] = []
    const fixes: string[] = []
    if (r.expected_transit_days > maxDays) {
      facts.push(`takes ${Math.ceil(r.expected_transit_days)} days`)
      fixes.push(`set the deadline to ${Math.ceil(r.expected_transit_days)} days or more`)
    }
    if (r.total_cost_usd > budget) {
      facts.push(`costs ${fmtUsd(r.total_cost_usd)}`)
      fixes.push(`raise the budget to ${fmtUsd(Math.ceil(r.total_cost_usd / 100) * 100)} or more`)
    }
    return { facts: joinAnd(facts), fixes: joinAnd(fixes) }
  }

  if (fits.length === 1) {
    const head = `With these limits only “${fits[0].route_name}” fits, so every goal picks it.`
    if (!next) return head
    const h = howToFit(next)
    return `${head} The next closest, “${next.route_name}”, ${h.facts}: ${h.fixes} to compare routes again.`
  }
  const head = "No route fits these limits, so every goal shows the least-bad option."
  if (!next) return head
  const h = howToFit(next)
  return `${head} The closest, “${next.route_name}”, ${h.facts}: ${h.fixes} to make it fit.`
}
