import { AlertTriangle, Check, Minus, Scale, ShieldCheck, Target, X } from "lucide-react"

import { Disclosure } from "@/components/Disclosure"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAsync } from "@/hooks/useAsync"
import { api, type Strategy } from "@/lib/api"
import { fmtPct } from "@/lib/format"
import { goalLabel } from "@/lib/plain"
import { cn } from "@/lib/utils"

const STRATEGY_LABEL: Record<Strategy, string> = {
  system: "Our system",
  always_cheapest: "Always pick the cheapest",
  always_fastest: "Always pick the fastest",
  always_safest: "Always pick the safest",
}

export function EvaluationView() {
  const { data, error } = useAsync((signal) => api.evaluate(signal), [])

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm">
          <AlertTriangle className="size-4 text-[var(--status-warning)]" /> {error.message}
        </CardContent>
      </Card>
    )
  }
  if (!data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const n = data.n_shipments
  const ceiling = n - data.no_feasible_route_count
  const byKey = Object.fromEntries(data.strategies.map((s) => [s.strategy, s])) as Record<Strategy, (typeof data.strategies)[number]>
  const sound = (s: Strategy) => Math.round(byKey[s].sound_decision_rate * n)
  const brokeLimits = (s: Strategy) => n - Math.round(byKey[s].constraint_satisfaction_rate * n)
  const beaten = (s: Strategy) => n - Math.round(byKey[s].pareto_optimal_rate * n)
  const baselines: Strategy[] = ["always_cheapest", "always_fastest", "always_safest"]

  const shortfall = (s: Strategy) => {
    const parts: string[] = []
    if (brokeLimits(s)) parts.push(`breaks the deadline or budget for ${brokeLimits(s)}`)
    if (beaten(s)) parts.push(`picks a route that another one beats on everything for ${beaten(s)}`)
    return parts.length ? parts.join(" and ") : "makes sound picks, but ignores each shipment's own goal"
  }

  return (
    <div className="space-y-6">
      <Card className="border-[var(--viz-series-1)]/40">
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">Tested on {n} shipments</div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Our system made a sound choice for {sound("system")} of {n} shipments.
          </h2>
          <p className="text-muted-foreground">
            “Sound” means the route meets the deadline and budget, and no other route within those limits is cheaper,
            faster and safer at the same time. Simple one-rule approaches fall short:
          </p>
          <ul className="space-y-1 text-sm">
            {baselines.map((b) => (
              <li key={b}>
                <span className="font-medium">{STRATEGY_LABEL[b]}</span>{" "}
                <span className="text-muted-foreground">{shortfall(b)}.</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* 2. One chart */}
      <Card>
        <CardHeader>
          <CardTitle>Sound decisions</CardTitle>
          <CardDescription>
            Shipments (out of {n}) where the pick is within limits and not beaten on every factor.
            {ceiling < n && ` The dashed line marks the best any method could do (${ceiling}).`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.strategies.map((s) => {
            const c = sound(s.strategy)
            const isOurs = s.strategy === "system"
            return (
              <div key={s.strategy} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem] items-center gap-3">
                <span className={cn("text-sm", isOurs ? "font-semibold" : "text-muted-foreground")}>
                  {STRATEGY_LABEL[s.strategy]}
                </span>
                <div className="relative h-6 rounded-md bg-[var(--viz-track)]" title={`${c} of ${n}`}>
                  <div
                    className="h-full rounded-md"
                    style={{ width: `${(c / n) * 100}%`, background: isOurs ? "var(--viz-series-1)" : "var(--viz-neutral)" }}
                  />
                  {ceiling < n && (
                    <div
                      className="absolute inset-y-[-4px] border-l-2 border-dashed border-foreground/40"
                      style={{ left: `${(ceiling / n) * 100}%` }}
                      aria-hidden
                    />
                  )}
                </div>
                <span className={cn("text-right text-sm tabular-nums", isOurs && "font-semibold")}>
                  {c} / {n}
                </span>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* 3. Three plain facts */}
      <div className="grid gap-4 md:grid-cols-3">
        <Fact
          icon={<Target className="size-5 text-[var(--viz-series-1)]" />}
          title="Never a wasted pick"
          text={`In ${fmtPct(byKey.system.pareto_optimal_rate)} of shipments it never chose a route that another route beats on cost, time and risk at once.`}
        />
        <Fact
          icon={<ShieldCheck className="size-5 text-[var(--status-good)]" />}
          title="Steady decisions"
          text={`For ${fmtPct(data.weight_stability_rate)} of shipments, the choice stays the same even if priorities shift by ±20%.`}
        />
        <Fact
          icon={<Scale className="size-5 text-[var(--status-warning)]" />}
          title="The honest trade-off"
          text={`It spends more on freight than always picking the cheapest route (+${byKey.system.avg_freight_premium_pct.toFixed(0)}% on average), because it follows each shipment's goal: “Fastest” shipments pay for speed, and “Lowest risk” ones avoid cheaper conflict-zone routes.`}
        />
      </div>

      <Disclosure boxed={false} title="Show details" hint="Full metrics per strategy and every shipment's decision">
        <Card>
          <CardHeader>
            <CardTitle>All metrics by strategy</CardTitle>
            <CardDescription>Premiums are relative to the best route available for each shipment.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Strategy</TableHead>
                  <TableHead className="text-right">Limits met</TableHead>
                  <TableHead className="text-right">Not beaten on all</TableHead>
                  <TableHead className="text-right">Extra cost vs cheapest</TableHead>
                  <TableHead className="text-right">Extra risk-adjusted cost</TableHead>
                  <TableHead className="text-right">Extra days vs fastest</TableHead>
                  <TableHead className="text-right">Avg delay chance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.strategies.map((s) => (
                  <TableRow key={s.strategy} className={cn(s.strategy === "system" && "bg-muted/40 font-medium")}>
                    <TableCell>{STRATEGY_LABEL[s.strategy]}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtPct(s.constraint_satisfaction_rate, 1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtPct(s.pareto_optimal_rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">+{s.avg_freight_premium_pct.toFixed(0)}%</TableCell>
                    <TableCell className="text-right tabular-nums">+{s.avg_expected_cost_premium_pct.toFixed(0)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{s.avg_extra_days_vs_fastest.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtPct(s.avg_delay_probability)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Every shipment's decision</CardTitle>
            <CardDescription>A dash means the simple rule picked the same route as our system.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shipment</TableHead>
                  <TableHead>Goal</TableHead>
                  <TableHead>Our pick</TableHead>
                  <TableHead>Cheapest</TableHead>
                  <TableHead>Fastest</TableHead>
                  <TableHead>Safest</TableHead>
                  <TableHead>Limits met</TableHead>
                  <TableHead>Stable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.shipments.map((s) => (
                  <TableRow key={s.shipment_id}>
                    <TableCell className="font-mono text-xs">{s.shipment_id}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{goalLabel(s.priority)}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium">{s.system_route_id.split("-").pop()}</TableCell>
                    <Same pick={s.cheapest_route_id} ours={s.system_route_id} />
                    <Same pick={s.fastest_route_id} ours={s.system_route_id} />
                    <Same pick={s.safest_route_id} ours={s.system_route_id} />
                    <TableCell>
                      <YesNo ok={s.system_feasible} />
                    </TableCell>
                    <TableCell>
                      <YesNo ok={s.weight_stable} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Disclosure>
    </div>
  )
}

function Fact({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Card>
      <CardContent className="space-y-2">
        {icon}
        <div className="font-medium">{title}</div>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  )
}

function Same({ pick, ours }: { pick: string; ours: string }) {
  return (
    <TableCell className="font-mono text-xs">
      {pick === ours ? (
        <Minus className="size-3 text-muted-foreground" aria-label="same as ours" />
      ) : (
        pick.split("-").pop()
      )}
    </TableCell>
  )
}

function YesNo({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-xs">
      <Check className="size-3.5 text-[var(--status-good)]" /> Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs">
      <X className="size-3.5 text-[var(--status-critical)]" /> No
    </span>
  )
}
