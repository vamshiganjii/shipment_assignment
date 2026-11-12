import type { Priority } from "@/lib/api"

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1,
})

export const fmtUsd = (n: number) => usd0.format(n)
export const fmtUsdCompact = (n: number) => compactUsd.format(n)
export const fmtPct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`
/** Whole days for display (never below 1). The engine keeps the exact expected value. */
export const wholeDays = (n: number) => Math.max(1, Math.round(n))
export const fmtDays = (n: number) => `${wholeDays(n)} d`
export const fmtTransit = (n: number) => `${wholeDays(n)} days`
export const fmtRisk = (n: number) => n.toFixed(2)
export const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

export const PRIORITY_LABEL: Record<Priority, string> = {
  cost: "Cost first",
  time: "Time first",
  balanced: "Balanced",
  risk_averse: "Risk averse",
}

export const CRITERIA = [
  { key: "cost", label: "Low cost", hint: "Freight price plus the expected cost of delays and damage" },
  { key: "time", label: "Speed", hint: "Fewer days in transit" },
  { key: "risk", label: "Safety", hint: "Avoid conflict zones and congested ports" },
  { key: "delay", label: "On-time reliability", hint: "Lower chance of arriving late" },
] as const