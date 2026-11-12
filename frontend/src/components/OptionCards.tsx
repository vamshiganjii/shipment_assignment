import { Ban, Crown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { Recommendation, RouteEvaluation } from "@/lib/api"
import { fmtUsd, fmtTransit } from "@/lib/format"
import { RISK_COLOR, bestAtTags, riskLevel, verdict } from "@/lib/plain"
import { cn } from "@/lib/utils"

const ORDER = { recommended: 0, ranked: 1, dominated: 2, rejected: 3 } as const

/** Every option side by side, with a plain-language verdict. */
export function OptionCards({ rec, loading }: { rec: Recommendation; loading: boolean }) {
  const routes = [...rec.routes].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.rank ?? 9) - (b.rank ?? 9))
  const tags = bestAtTags(rec.routes)

  return (
    <section className={cn("space-y-3 transition-opacity", loading && "opacity-60")}>
      <div>
        <h2 className="text-base font-semibold">All {routes.length} options compared</h2>
        <p className="text-sm text-muted-foreground">Ruled-out options are shown so you can see what you would give up.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {routes.map((r) => (
          <OptionCard key={r.route_id} r={r} rec={rec} tags={tags[r.route_id] ?? []} />
        ))}
      </div>
    </section>
  )
}

function OptionCard({ r, rec, tags }: { r: RouteEvaluation; rec: Recommendation; tags: string[] }) {
  const v = verdict(r, rec)
  const risk = riskLevel(r.geopolitical_risk)
  const { budget_usd: budget, max_transit_days: deadline } = rec.constraints

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4",
        v.tone === "best" && "border-[var(--viz-series-1)] ring-1 ring-[var(--viz-series-1)]/30",
        v.tone === "bad" && "opacity-80",
      )}
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {v.tone === "best" ? (
            <Badge className="bg-[var(--viz-series-1)] text-white">
              <Crown /> {v.label}
            </Badge>
          ) : v.tone === "bad" ? (
            <Badge variant="outline">
              <Ban className="text-[var(--status-critical)]" /> {v.label}
            </Badge>
          ) : (
            <Badge variant="secondary">{v.label}</Badge>
          )}
          {tags.map((t) => (
            <Badge key={t} variant="outline" className="text-muted-foreground">
              {t}
            </Badge>
          ))}
        </div>
        <div className="font-medium leading-snug">{r.route_name}</div>
        <div className="text-xs text-muted-foreground">
          {r.route_type} · {r.carrier}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Row label="Cost" value={fmtUsd(r.total_cost_usd)} warn={r.total_cost_usd > budget} />
        <Row label="Arrives in" value={`~${fmtTransit(r.expected_transit_days)}`} warn={r.expected_transit_days > deadline} />
        <Row label="On-time chance" value={`${Math.round(r.on_time_reliability * 100)}%`} />
        <div>
          <dt className="text-xs text-muted-foreground">Risk</dt>
          <dd className="flex items-center gap-1.5 font-medium">
            <span className="size-2 rounded-full" style={{ background: RISK_COLOR[risk] }} aria-hidden />
            {risk}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium tabular-nums", warn && "text-[var(--status-critical)]")}>{value}</dd>
    </div>
  )
}
