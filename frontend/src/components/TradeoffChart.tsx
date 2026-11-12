import { useState } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useElementWidth } from "@/hooks/useElementWidth"
import type { Recommendation, RouteEvaluation } from "@/lib/api"
import { fmtDays, fmtPct, fmtRisk, fmtUsd, fmtUsdCompact } from "@/lib/format"

const HEIGHT = 300
const M = { top: 20, right: 20, bottom: 40, left: 52 }

function niceLinearTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1
  const step0 = span / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? mag * 10
  const ticks: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v)
  return ticks
}

function logTicks(min: number, max: number): number[] {
  const ticks: number[] = []
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e
      if (v >= min && v <= max) ticks.push(v)
    }
  }
  return ticks
}

export function TradeoffChart({ rec }: { rec: Recommendation }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(320)
  const [hover, setHover] = useState<RouteEvaluation | null>(null)

  const routes = rec.routes
  const { budget_usd: budget, max_transit_days: deadline } = rec.constraints

  // ---- scales
  const costs = routes.map((r) => r.total_cost_usd).concat(budget)
  const cMin = Math.min(...costs) * 0.8
  const cMax = Math.max(...costs) * 1.15
  const useLog = cMax / cMin > 8
  const innerW = width - M.left - M.right
  const innerH = HEIGHT - M.top - M.bottom
  const x = (v: number) =>
    M.left +
    (useLog
      ? ((Math.log10(v) - Math.log10(cMin)) / (Math.log10(cMax) - Math.log10(cMin))) * innerW
      : ((v - cMin) / (cMax - cMin)) * innerW)
  const dMax = Math.max(deadline, ...routes.map((r) => r.expected_transit_days)) * 1.12
  const y = (v: number) => M.top + innerH - (v / dMax) * innerH

  const xTicks = useLog ? logTicks(cMin, cMax) : niceLinearTicks(cMin, cMax, Math.max(3, Math.floor(innerW / 110)))
  const yTicks = niceLinearTicks(0, dMax, 5)

  const labels = routes
    .map((r) => ({ r, px: x(r.total_cost_usd), py: y(r.expected_transit_days) }))
    .sort((a, b) => a.py - b.py)
  const placed: { r: RouteEvaluation; lx: number; ly: number; anchor: "start" | "end" }[] = []
  for (const l of labels) {
    const anchor = l.px > M.left + innerW * 0.62 ? "end" : "start"
    let ly = l.py + 4
    for (const p of placed) if (Math.abs(p.ly - ly) < 14 && Math.abs(p.lx - l.px) < 180) ly = p.ly + 14
    placed.push({ r: l.r, lx: l.px + (anchor === "start" ? 11 : -11), ly, anchor })
  }
  const shortName = (s: string) => (s.length > 26 ? `${s.slice(0, 25)}…` : s)

  const budgetX = x(budget)
  const deadlineY = y(deadline)

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Cost vs. transit time</CardTitle>
        <CardDescription>
          Each dot is a route option. The shaded zone meets both the deadline and the budget
          {useLog ? " (cost axis is logarithmic)" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Legend />
        <div ref={ref} className="relative mt-3 w-full min-w-0 overflow-hidden">
          <svg width={width} height={HEIGHT} role="img" aria-label="Scatter plot of route cost versus transit time">
            {/* feasible zone */}
            <rect
              x={M.left}
              y={deadlineY}
              width={Math.max(0, Math.min(budgetX, M.left + innerW) - M.left)}
              height={Math.max(0, M.top + innerH - deadlineY)}
              fill="var(--viz-series-1)"
              opacity={0.07}
            />

            {/* grid + axes */}
            {yTicks.map((t) => (
              <g key={`y${t}`}>
                <line x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" />
                <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                  {t}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text
                key={`x${t}`}
                x={x(t)}
                y={M.top + innerH + 18}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {fmtUsdCompact(t)}
              </text>
            ))}
            <text x={M.left + innerW / 2} y={HEIGHT - 4} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              Freight cost (USD)
            </text>
            <text
              transform={`translate(12 ${M.top + innerH / 2}) rotate(-90)`}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              Expected transit (days)
            </text>

            {/* constraint lines */}
            <line x1={M.left} x2={M.left + innerW} y1={deadlineY} y2={deadlineY} stroke="var(--viz-neutral)" strokeDasharray="4 4" />
            <text x={M.left + innerW} y={deadlineY - 6} textAnchor="end" className="fill-muted-foreground text-[11px]">
              Deadline {deadline} d
            </text>
            {budgetX <= M.left + innerW && (
              <>
                <line x1={budgetX} x2={budgetX} y1={M.top} y2={M.top + innerH} stroke="var(--viz-neutral)" strokeDasharray="4 4" />
                <text x={budgetX + 4} y={M.top + 10} className="fill-muted-foreground text-[11px]">
                  Budget
                </text>
              </>
            )}

            {/* points */}
            {routes.map((r) => {
              const cx = x(r.total_cost_usd)
              const cy = y(r.expected_transit_days)
              const isBest = r.status === "recommended"
              const isRejected = r.status === "rejected"
              return (
                <g key={r.route_id} onMouseEnter={() => setHover(r)} onMouseLeave={() => setHover(null)}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isBest ? 8 : 6}
                    fill={isRejected ? "var(--card)" : isBest ? "var(--viz-series-1)" : "var(--viz-neutral)"}
                    stroke={isRejected ? "var(--viz-neutral)" : "var(--card)"}
                    strokeWidth={2}
                  />
                  <circle cx={cx} cy={cy} r={16} fill="transparent" className="cursor-pointer" />
                </g>
              )
            })}
            {placed.map((p) => (
              <text
                key={`l${p.r.route_id}`}
                x={p.lx}
                y={p.ly}
                textAnchor={p.anchor}
                className={
                  p.r.status === "recommended"
                    ? "pointer-events-none fill-foreground text-[11px] font-semibold"
                    : "pointer-events-none fill-muted-foreground text-[11px]"
                }
              >
                {shortName(p.r.route_name)}
              </text>
            ))}
          </svg>

          {hover && (
            <div
              className="pointer-events-none absolute z-10 w-56 rounded-lg border bg-popover p-3 text-xs shadow-md"
              style={{
                left: Math.min(x(hover.total_cost_usd) + 14, width - 230),
                top: Math.max(0, y(hover.expected_transit_days) - 20),
              }}
            >
              <div className="mb-1 font-semibold text-foreground">{hover.route_name}</div>
              <TipRow k="Freight" v={fmtUsd(hover.total_cost_usd)} />
              <TipRow k="Risk-adjusted cost" v={fmtUsd(hover.metrics.expected_total_cost_usd)} />
              <TipRow k="Expected days" v={fmtDays(hover.expected_transit_days)} />
              <TipRow k="On-time" v={fmtPct(hover.on_time_reliability)} />
              <TipRow k="Geo risk" v={fmtRisk(hover.geopolitical_risk)} />
              {hover.rejected_reasons.length > 0 && (
                <div className="mt-1 text-muted-foreground">{hover.rejected_reasons.join("; ")}</div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function TipRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium tabular-nums text-foreground">{v}</span>
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <LegendItem>
        <circle cx="6" cy="6" r="5" fill="var(--viz-series-1)" />
        <span>Recommended</span>
      </LegendItem>
      <LegendItem>
        <circle cx="6" cy="6" r="4.5" fill="var(--viz-neutral)" />
        <span>Other option</span>
      </LegendItem>
      <LegendItem>
        <circle cx="6" cy="6" r="4" fill="none" stroke="var(--viz-neutral)" strokeWidth="2" />
        <span>Rejected (constraint)</span>
      </LegendItem>
      <LegendItem>
        <line x1="0" x2="12" y1="6" y2="6" stroke="var(--viz-neutral)" strokeDasharray="3 2" />
        <span>Deadline / budget</span>
      </LegendItem>
    </div>
  )
}

function LegendItem({ children }: { children: [React.ReactNode, React.ReactNode] }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="12" height="12" aria-hidden>
        {children[0]}
      </svg>
      {children[1]}
    </span>
  )
}
