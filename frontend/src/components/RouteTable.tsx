import { Ban, Crown, Layers } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { RouteEvaluation, RouteStatus } from "@/lib/api"
import { fmtDays, fmtPct, fmtRisk, fmtUsd } from "@/lib/format"
import { cn } from "@/lib/utils"

function StatusBadge({ status }: { status: RouteStatus }) {
  switch (status) {
    case "recommended":
      return (
        <Badge className="bg-[var(--viz-series-1)] text-white">
          <Crown /> Recommended
        </Badge>
      )
    case "ranked":
      return <Badge variant="secondary">Alternative</Badge>
    case "dominated":
      return (
        <Badge variant="outline">
          <Layers /> Dominated
        </Badge>
      )
    case "rejected":
      return (
        <Badge variant="destructive">
          <Ban /> Rejected
        </Badge>
      )
  }
}

function note(r: RouteEvaluation): string {
  if (r.rejected_reasons.length) return r.rejected_reasons.join("; ")
  if (r.status === "dominated") return "Another route is at least as good on cost, time and risk"
  return ""
}

export function RouteTable({ routes, loading }: { routes: RouteEvaluation[]; loading: boolean }) {
  return (
    <Card className={cn("transition-opacity", loading && "opacity-60")}>
      <CardHeader>
        <CardTitle>All route options</CardTitle>
        <CardDescription>
          Constraints filter first, dominated routes drop out, then TOPSIS scores the rest (1 = ideal).
          Risk-adjusted cost adds the expected late penalty and expected cargo loss.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Freight</TableHead>
              <TableHead className="text-right">Risk-adj. cost</TableHead>
              <TableHead className="text-right">Expected days</TableHead>
              <TableHead className="text-right">On-time</TableHead>
              <TableHead className="text-right">Geo risk</TableHead>
              <TableHead className="w-36">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((r) => (
              <TableRow key={r.route_id} className={cn(r.status === "recommended" && "bg-muted/40")}>
                <TableCell className="tabular-nums text-muted-foreground">{r.rank ?? "–"}</TableCell>
                <TableCell className="max-w-72 whitespace-normal">
                  <div className="font-medium">{r.route_name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{r.hubs_path}</div>
                  {note(r) && <div className="mt-0.5 text-xs text-muted-foreground">{note(r)}</div>}
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsd(r.total_cost_usd)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtUsd(r.metrics.expected_total_cost_usd)}</TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  title={`Expected ${r.expected_transit_days.toFixed(1)} days, including likely delays`}
                >
                  {fmtDays(r.expected_transit_days)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct(r.on_time_reliability)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtRisk(r.geopolitical_risk)}</TableCell>
                <TableCell>
                  {r.score === null ? (
                    <span className="text-xs text-muted-foreground">not scored</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--viz-track)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(2, r.score * 100)}%`,
                            background: r.status === "recommended" ? "var(--viz-series-1)" : "var(--viz-neutral)",
                          }}
                        />
                      </div>
                      <span className="w-9 text-right text-xs tabular-nums">{r.score.toFixed(2)}</span>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
