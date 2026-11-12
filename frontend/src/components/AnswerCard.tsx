import { AlertTriangle, ArrowRight, CheckCircle2, Plane, Ship, ShieldCheck, TrainFront, Truck, XCircle } from "lucide-react"
import { Fragment } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent } from "@/components/ui/card"
import type { Leg, Recommendation, Route, Sensitivity } from "@/lib/api"
import { fmtUsd, fmtTransit } from "@/lib/format"
import { CONFIDENCE, RISK_COLOR, goalLabel, reasons, riskLevel } from "@/lib/plain"
import { cn } from "@/lib/utils"

const MODE_ICON = { sea: Ship, rail: TrainFront, truck: Truck, air: Plane } as const

interface Props {
  rec: Recommendation
  route: Route | undefined
  sensitivity: Sensitivity | undefined // only passed when it matches the current settings
  loading: boolean
}

/** The answer, in one glance: which route, the four numbers that matter, and why. */
export function AnswerCard({ rec, route, sensitivity, loading }: Props) {
  const best = rec.routes.find((r) => r.status === "recommended")
  if (!best) return null
  const { max_transit_days: deadline, budget_usd: budget } = rec.constraints
  const risk = riskLevel(best.geopolitical_risk)
  const conf = sensitivity ? CONFIDENCE[sensitivity.verdict] : undefined

  return (
    <Card className={cn("border-[var(--viz-series-1)]/40 transition-opacity", loading && "opacity-60")}>
      <CardContent className="space-y-6">
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">
            We recommend, for <span className="font-medium text-foreground">{goalLabel(rec.priority)}</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{best.route_name}</h2>
          <div className="text-sm text-muted-foreground">
            {best.route_type} · {best.carrier}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <BigNumber
            label="Cost"
            value={fmtUsd(best.total_cost_usd)}
            ok={best.total_cost_usd <= budget}
            note={best.total_cost_usd <= budget ? `within ${fmtUsd(budget)} budget` : `over ${fmtUsd(budget)} budget`}
          />
          <BigNumber
            label="Arrives in"
            value={`~${fmtTransit(best.expected_transit_days)}`}
            ok={best.expected_transit_days <= deadline}
            note={best.expected_transit_days <= deadline ? `meets ${deadline}-day deadline` : `misses ${deadline}-day deadline`}
          />
          <BigNumber
            label="On-time chance"
            value={`${Math.round(best.on_time_reliability * 100)}%`}
            note="probability of no delay"
          />
          <div className="rounded-xl bg-muted/50 p-4">
            <div className="text-xs text-muted-foreground">Route risk</div>
            <div className="mt-1 flex items-center gap-2 text-2xl font-semibold">
              <span className="size-3 rounded-full" style={{ background: RISK_COLOR[risk] }} aria-hidden />
              {risk}
            </div>
            <div className="text-xs text-muted-foreground">conflict zones & congestion</div>
          </div>
        </div>

        {rec.no_feasible_route && (
          <Alert>
            <AlertTriangle className="text-[var(--status-warning)]" />
            <AlertTitle>No option meets every limit</AlertTitle>
            <AlertDescription>
              This is the closest fit. Consider extending the deadline or budget under “Fine-tune”.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Why this route?</h3>
            <ul className="space-y-2 text-sm">
              {reasons(rec).map((r, i) => (
                <li key={i} className="flex gap-2">
                  {r.startsWith("Watch out") ? (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--status-warning)]" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--viz-series-1)]" />
                  )}
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            {conf && sensitivity && (
              <div className="space-y-1">
                <h3 className="text-sm font-medium">How sure are we?</h3>
                <div className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="size-4" style={{ color: conf.color }} />
                  <span className="font-medium">{conf.label} confidence</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Same answer in {Math.round(sensitivity.monte_carlo.base_pick_win_rate * 100)}% of{" "}
                  {sensitivity.monte_carlo.n_samples} what-if tests with uncertain costs, delays and risks.
                </p>
              </div>
            )}
            {route && <RoutePath legs={route.legs} />}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function BigNumber({ label, value, note, ok }: { label: string; value: string; note: string; ok?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/50 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {ok === true && <CheckCircle2 className="size-3.5 text-[var(--status-good)]" />}
        {ok === false && <XCircle className="size-3.5 text-[var(--status-critical)]" />}
        {note}
      </div>
    </div>
  )
}

function RoutePath({ legs }: { legs: Leg[] }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-medium">Journey</h3>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
        {legs.map((leg, i) => {
          const Icon = MODE_ICON[leg.mode]
          return (
            <Fragment key={i}>
              {i === 0 && <Hub code={leg.from_hub} />}
              <span
                className="flex items-center gap-1 text-muted-foreground"
                title={`${leg.mode}, ${leg.transit_days} days${leg.via_chokepoints ? `, via ${leg.via_chokepoints.replace(/\|/g, ", ")}` : ""}`}
              >
                <ArrowRight className="size-3" />
                <Icon className="size-3.5" aria-label={leg.mode} />
                {leg.geopolitical_risk >= 0.6 && (
                  <AlertTriangle className="size-3 text-[var(--status-critical)]" aria-label="high-risk area" />
                )}
                <ArrowRight className="size-3" />
              </span>
              <Hub code={leg.to_hub} />
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function Hub({ code }: { code: string }) {
  return <span className="rounded-md border bg-background px-1.5 py-0.5 font-mono">{code}</span>
}
