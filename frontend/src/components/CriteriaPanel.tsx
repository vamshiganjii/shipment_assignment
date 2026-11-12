import { Check, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import type { Priority, RouteEvaluation, Weights } from "@/lib/api"
import { CRITERIA, fmtUsd, fmtTransit } from "@/lib/format"
import { riskLevel } from "@/lib/plain"
import { cn } from "@/lib/utils"

type CriterionKey = (typeof CRITERIA)[number]["key"]

/** The real value each competing route has for a factor (lower raw value = better). */
const FACTOR: Record<CriterionKey, { raw: (r: RouteEvaluation) => number; show: (r: RouteEvaluation) => string }> = {
  cost: { raw: (r) => r.metrics.expected_total_cost_usd, show: (r) => fmtUsd(r.metrics.expected_total_cost_usd) },
  time: { raw: (r) => r.expected_transit_days, show: (r) => fmtTransit(r.expected_transit_days) },
  risk: { raw: (r) => r.metrics.risk_index, show: (r) => `${riskLevel(r.geopolitical_risk)} risk` },
  delay: { raw: (r) => r.delay_probability, show: (r) => `${Math.round(r.on_time_reliability * 100)}% on time` },
}

const shortName = (s: string) => s.replace(/^Direct (via )?/, "").replace(/^Transship /, "")

export interface Criteria {
  priority: Priority
  weights: Weights // raw slider values 0..100 (backend normalises them)
  custom: boolean // true once the user moves a slider
  maxTransitDays: string
  budgetUsd: string
}

interface Props {
  value: Criteria
  onChange: (next: Criteria) => void
  onReset: () => void
  defaults: { maxTransitDays: number; budgetUsd: number } | undefined
  routes: RouteEvaluation[]
  loading: boolean
  defaultRouteId: string | undefined
}

export function CriteriaPanel({ value, onChange, onReset, defaults, routes, loading, defaultRouteId }: Props) {
  const competing = routes
    .filter((r) => r.status === "recommended" || r.status === "ranked")
    .sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9))
  const allZero = CRITERIA.every((c) => value.weights[c.key] === 0)
  const total = CRITERIA.reduce((sum, c) => sum + value.weights[c.key], 0) || 1

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">How important is each factor?</h3>
          <p className="text-sm text-muted-foreground">
            The percentages show each factor's share of the decision and always add up to 100%. Under each slider you
            can see how the routes compare on that factor (✓ = best of the routes still in the running; crossed out = ruled out by the limits).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw /> Reset
        </Button>
      </div>

      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {CRITERIA.map((c) => (
          <div key={c.key} className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor={`w-${c.key}`}>{c.label}</Label>
              <span className="text-sm font-semibold tabular-nums">{Math.round((value.weights[c.key] / total) * 100)}%</span>
            </div>
            <Slider
              id={`w-${c.key}`}
              aria-label={`${c.label} weight`}
              min={0}
              max={100}
              step={5}
              value={[value.weights[c.key]]}
              onValueChange={(v) => {
                const n = Array.isArray(v) ? v[0] : (v as number)
                onChange({ ...value, custom: true, weights: { ...value.weights, [c.key]: n } })
              }}
            />
            <p className="text-xs text-muted-foreground">{c.hint}</p>
            <FactorValues routes={routes} competing={competing} factor={c.key} />
          </div>
        ))}
      </div>
      {competing.length <= 1 && (
        <p className="text-xs text-muted-foreground">
          Only one route is still in the running, so the sliders can't change the answer. Loosen the deadline or budget
          below to bring more routes back.
        </p>
      )}
      {allZero && (
        <p className="text-xs text-[var(--status-critical)]">Give at least one factor a score above 0.</p>
      )}

      <div className="space-y-1">
        <h3 className="text-sm font-medium">What if the limits were different?</h3>
        <p className="text-sm text-muted-foreground">Leave empty to use the shipment's own deadline and budget.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <LimitInput
          id="deadline"
          label="Deadline (days)"
          value={value.maxTransitDays}
          placeholder={defaults ? String(defaults.maxTransitDays) : ""}
          onChange={(v) => onChange({ ...value, maxTransitDays: v })}
        />
        <LimitInput
          id="budget"
          label="Budget (USD)"
          value={value.budgetUsd}
          placeholder={defaults ? String(defaults.budgetUsd) : ""}
          onChange={(v) => onChange({ ...value, budgetUsd: v })}
        />
      </div>

      <LiveResult routes={routes} loading={loading} defaultRouteId={defaultRouteId} />
    </div>
  )
}

function FactorValues({
  routes,
  competing,
  factor,
}: {
  routes: RouteEvaluation[]
  competing: RouteEvaluation[]
  factor: CriterionKey
}) {
  const f = FACTOR[factor]
  const inRunning = new Set(competing.map((r) => r.route_id))
  const best = competing.length > 1 ? Math.min(...competing.map(f.raw)) : undefined
  const ordered = [...competing, ...routes.filter((r) => !inRunning.has(r.route_id))]
  return (
    <ul className="flex flex-wrap gap-1.5">
      {ordered.map((r) => {
        const active = inRunning.has(r.route_id)
        const isBest = active && best !== undefined && f.raw(r) === best
        const why = r.rejected_reasons.length
          ? r.rejected_reasons.join("; ")
          : "beaten by another route on every factor"
        return (
          <li
            key={r.route_id}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
              isBest && "border-[var(--viz-series-1)]/50 bg-[var(--viz-series-1)]/10",
              !isBest && "text-muted-foreground",
              !active && "border-dashed opacity-60",
            )}
            title={active ? r.route_name : `${r.route_name}: ruled out (${why})`}
          >
            {isBest && <Check className="size-3 text-[var(--viz-series-1)]" aria-label="best" />}
            <span className={cn("max-w-32 truncate", !active && "line-through")}>{shortName(r.route_name)}</span>
            <span className={cn("font-medium tabular-nums", active ? "text-foreground" : "line-through")}>{f.show(r)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function LiveResult({ routes, loading, defaultRouteId }: { routes: RouteEvaluation[]; loading: boolean; defaultRouteId?: string }) {
  const best = routes.find((r) => r.status === "recommended")
  if (!best) return null
  const fits = routes.filter((r) => r.feasible).length
  const defaultRoute = routes.find((r) => r.route_id === defaultRouteId)
  const changed = defaultRoute && defaultRoute.route_id !== best.route_id

  return (
    <div
      aria-live="polite"
      className={cn(
        "rounded-lg border p-3 text-sm transition-opacity",
        changed ? "border-[var(--viz-series-1)] bg-[var(--viz-series-1)]/10" : "bg-muted/40",
        loading && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-muted-foreground">{loading ? "Updating…" : "With these settings →"}</span>
        <span className="font-semibold">{best.route_name}</span>
        <span className="tabular-nums text-muted-foreground">
          {fmtUsd(best.total_cost_usd)} · ~{fmtTransit(best.expected_transit_days)}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {changed
          ? `Changed from “${defaultRoute.route_name}” (the pick with the shipment's own settings). `
          : defaultRoute
            ? "Same route as with the shipment's own settings. "
            : ""}
        {fits === 0
          ? "No route fits these limits, so this is the least-bad option."
          : `${fits} of ${routes.length} routes fit these limits.`}
      </div>
    </div>
  )
}

function LimitInput(props: { id: string; label: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  const invalid = props.value !== "" && !(Number(props.value) > 0)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type="number"
        inputMode="decimal"
        min={1}
        value={props.value}
        placeholder={`${props.placeholder} (shipment default)`}
        aria-invalid={invalid}
        className={cn("tabular-nums", invalid && "border-destructive")}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  )
}
