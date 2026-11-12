import { CalendarClock, CheckCircle2, Flame, Snowflake, Wallet, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import type { Priority, RouteEvaluation, ShipmentDetail, ShipmentSummary } from "@/lib/api"
import { fmtUsd, titleCase, fmtTransit } from "@/lib/format"
import { GOALS, RISK_COLOR, limitsHint, riskLevel } from "@/lib/plain"
import { cn } from "@/lib/utils"

export interface GoalPreview {
  routeId: string
  routeName: string
  cost: number
  days: number
  geoRisk: number
}

interface Props {
  shipments: ShipmentSummary[] | undefined
  selectedId: string | undefined
  onSelect: (id: string) => void
  detail: ShipmentDetail | undefined
  /** Limits in use (the shipment's own, or the what-if values from Fine-tune). */
  limits: { maxTransitDays: number; budgetUsd: number; overridden: boolean } | undefined
  goal: Priority | undefined
  customWeights: boolean
  onGoal: (p: Priority) => void
  previews: Partial<Record<Priority, GoalPreview>> | undefined
  recommendedRouteId?: string
  routes?: RouteEvaluation[]
}

export function ShipmentBar(props: Props) {
  const { shipments, selectedId, onSelect, detail, limits, goal, customWeights, onGoal, previews, recommendedRouteId, routes } = props
  const items = (shipments ?? []).map((s) => ({
    value: s.shipment_id,
    label: `${s.shipment_id} · ${s.origin_name} → ${s.destination_name}`,
  }))

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label>1. Choose a shipment</Label>
            {shipments ? (
              <Select items={items} value={selectedId ?? null} onValueChange={(v) => v && onSelect(String(v))}>
                <SelectTrigger className="w-full" aria-label="Shipment">
                  <SelectValue placeholder="Select a shipment" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {items.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Skeleton className="h-8 w-full" />
            )}
            {detail ? (
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                {titleCase(detail.cargo_type)} · {detail.containers_feu} container{detail.containers_feu > 1 ? "s" : ""}
                {detail.perishable && (
                  <Badge variant="outline">
                    <Snowflake /> Perishable
                  </Badge>
                )}
                {detail.hazardous && (
                  <Badge variant="outline">
                    <Flame /> Hazardous
                  </Badge>
                )}
              </div>
            ) : (
              <Skeleton className="h-4 w-3/4" />
            )}
          </div>

          <div className="space-y-2">
            <Label>Customer limits {limits?.overridden ? "(what-if values)" : "(same for every goal)"}</Label>
            {limits ? (
              <div className="grid grid-cols-2 gap-2">
                <Limit icon={<CalendarClock className="size-4" />} label="Must arrive within" value={`${limits.maxTransitDays} days`} />
                <Limit icon={<Wallet className="size-4" />} label="Budget" value={fmtUsd(limits.budgetUsd)} />
              </div>
            ) : (
              <Skeleton className="h-14 w-full" />
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>2. What matters most? Each goal shows the route it would choose</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="What matters most">
            {GOALS.map((g) => {
              const active = !customWeights && goal === g.value
              const p = previews?.[g.value]
              // When every goal picks the same route, the note below explains it once; don't repeat it per card
              const allSame = !!previews && new Set(GOALS.map((o) => previews[o.value]?.routeId)).size === 1
              const sameAs =
                p && !allSame
                  ? GOALS.find((o) => o.value !== g.value && previews?.[o.value]?.routeId === p.routeId && GOALS.indexOf(o) < GOALS.indexOf(g))
                  : undefined
              const risk = p ? riskLevel(p.geoRisk) : undefined
              return (
                <button
                  key={g.value}
                  role="radio"
                  aria-checked={active}
                  onClick={() => onGoal(g.value)}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active ? "border-[var(--viz-series-1)] bg-[var(--viz-series-1)]/10" : "hover:bg-muted",
                    limits?.overridden && p && p.routeId === recommendedRouteId && "ring-2 ring-[var(--status-good)]/60",
                    limits?.overridden && p && routes?.find((r) => r.route_id === p.routeId)?.feasible === false && "opacity-60",
                  )}
                >
                  <div>
                    <div className="text-sm font-semibold">{g.label}</div>
                    <div className="text-xs text-muted-foreground">{g.hint}</div>
                  </div>
                  <div className="border-t pt-2">
                    {p && risk ? (
                      <>
                        <div className="truncate text-sm font-medium" title={p.routeName}>
                          → {p.routeName}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
                          <span className="font-medium text-foreground">{fmtUsd(p.cost)}</span>
                          <span>·</span>
                          <span className="font-medium text-foreground">~{fmtTransit(p.days)}</span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <span className="size-2 rounded-full" style={{ background: RISK_COLOR[risk] }} aria-hidden />
                            {risk} risk
                          </span>
                        </div>
                        {sameAs && <div className="text-xs text-muted-foreground">same route as “{sameAs.label}”</div>}
                        {limits?.overridden && (() => {
                          // What-if limits: keep the card, just mark whether its route still fits / is picked
                          const now = routes?.find((r) => r.route_id === p.routeId)
                          if (!now) return null
                          if (now.route_id === recommendedRouteId)
                            return (
                              <div className="mt-1 flex items-center gap-1 text-xs font-medium text-[var(--status-good)]">
                                <CheckCircle2 className="size-3.5" /> Picked with these limits
                              </div>
                            )
                          if (!now.feasible)
                            return (
                              <div className="mt-1 flex items-start gap-1 text-xs text-[var(--status-critical)]">
                                <XCircle className="mt-px size-3.5 shrink-0" /> Doesn't fit: {now.rejected_reasons.join("; ")}
                              </div>
                            )
                          return <div className="mt-1 text-xs text-muted-foreground">Still fits these limits</div>
                        })()}
                      </>
                    ) : (
                      <Skeleton className="h-9 w-full" />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
          {customWeights && <p className="text-xs text-muted-foreground">Using your fine-tuned weights (see “Fine-tune” below).</p>}
          {routes && limits && (() => {
            const hint = limitsHint(routes, limits.maxTransitDays, limits.budgetUsd)
            return hint && <p className="text-xs text-muted-foreground">{hint}</p>
          })()}
        </div>
      </CardContent>
    </Card>
  )
}

function Limit({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  )
}
