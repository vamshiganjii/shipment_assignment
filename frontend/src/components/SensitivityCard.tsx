import { AlertTriangle, CheckCircle2, CircleAlert, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { RouteEvaluation, Sensitivity, Verdict } from "@/lib/api"
import { fmtPct } from "@/lib/format"

const VERDICT: Record<Verdict, { label: string; icon: typeof CheckCircle2; color: string }> = {
  stable: { label: "Stable", icon: CheckCircle2, color: "var(--status-good)" },
  moderately_stable: { label: "Moderately stable", icon: CircleAlert, color: "var(--status-warning)" },
  sensitive: { label: "Sensitive: close call", icon: XCircle, color: "var(--status-critical)" },
}

interface Props {
  data: Sensitivity | undefined
  error: Error | undefined
  routes: RouteEvaluation[]
}

export function SensitivityCard({ data, error, routes }: Props) {
  const nameOf = (id: string) => routes.find((r) => r.route_id === id)?.route_name ?? id

  return (
    <Card>
      <CardHeader>
        <CardTitle>How robust is this pick?</CardTitle>
        <CardDescription>For the shipment's default priority: weights ±20% and simulated estimate errors.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="size-4 text-[var(--status-warning)]" /> {error.message}
          </p>
        )}
        {!data && !error && (
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {data && (
          <>
            <VerdictBadge verdict={data.verdict} />
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Weight scenarios unchanged" value={fmtPct(data.weight_stability)} />
              <Metric
                label={`Wins in ${data.monte_carlo.n_samples} simulations`}
                value={fmtPct(data.monte_carlo.base_pick_win_rate)}
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium">Monte Carlo win rate</h3>
              <ul className="space-y-2">
                {Object.entries(data.monte_carlo.route_win_rates).map(([id, rate]) => (
                  <li key={id} className="space-y-1">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="truncate text-muted-foreground">{nameOf(id)}</span>
                      <span className="font-medium tabular-nums">{fmtPct(rate)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--viz-track)]" title={`${nameOf(id)}: ${fmtPct(rate)}`}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${rate * 100}%`,
                          background: id === data.base_route_id ? "var(--viz-series-1)" : "var(--viz-neutral)",
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium">Weight scenarios</h3>
              <div className="flex flex-wrap gap-1.5">
                {data.weight_scenarios.map((s) => (
                  <Badge
                    key={s.name}
                    variant={s.same_as_base ? "outline" : "destructive"}
                    title={s.same_as_base ? "Same pick" : `Switches to ${nameOf(s.recommended_route_id)}`}
                  >
                    {s.same_as_base ? <CheckCircle2 /> : <XCircle />}
                    {s.name}
                  </Badge>
                ))}
              </div>
            </div>

            <p className="text-sm text-muted-foreground">{data.summary}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict]
  const Icon = v.icon
  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      <Icon className="size-5" style={{ color: v.color }} aria-hidden />
      {v.label}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}
