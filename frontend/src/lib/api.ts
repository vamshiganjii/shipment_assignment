// Typed client for the FastAPI backend. Types mirror backend/schemas/*.py.

export type Priority = "cost" | "time" | "balanced" | "risk_averse"
export type RouteStatus = "recommended" | "ranked" | "dominated" | "rejected"
export type Verdict = "stable" | "moderately_stable" | "sensitive"

export interface Weights {
  cost: number
  time: number
  risk: number
  delay: number
}

export interface ShipmentSummary {
  shipment_id: string
  origin: string
  origin_name: string
  destination: string
  destination_name: string
  ship_date: string
  cargo_type: string
  priority: Priority
  containers_feu: number
  cargo_value_usd: number
  num_route_options: number
}

export interface Leg {
  leg_seq: number | null
  from_hub: string
  to_hub: string
  mode: "sea" | "rail" | "truck" | "air"
  via_chokepoints: string
  distance_km: number
  transit_days: number
  cost_usd_per_feu: number
  geopolitical_risk: number
  congestion_index: number
  delay_probability: number
}

export interface Route {
  route_id: string
  route_name: string
  route_type: string
  carrier: string
  hubs_path: string
  chokepoints: string
  num_transshipments: number
  total_cost_usd: number
  expected_transit_days: number
  on_time_reliability: number
  geopolitical_risk: number
  co2_tonnes: number
  legs: Leg[]
}

export interface ShipmentDetail extends ShipmentSummary {
  required_delivery_date: string
  max_transit_days: number
  perishable: boolean
  hazardous: boolean
  weight_tonnes: number
  budget_usd: number
  late_penalty_usd_per_day: number
  peak_season: boolean
  routes: Route[]
}

export interface RouteEvaluation {
  route_id: string
  route_name: string
  route_type: string
  carrier: string
  hubs_path: string
  total_cost_usd: number
  expected_transit_days: number
  on_time_reliability: number
  delay_probability: number
  geopolitical_risk: number
  congestion_risk: number
  co2_tonnes: number
  metrics: {
    expected_total_cost_usd: number
    expected_transit_days: number
    risk_index: number
    delay_probability: number
  }
  status: RouteStatus
  feasible: boolean
  pareto_optimal: boolean | null
  score: number | null
  rank: number | null
  rejected_reasons: string[]
}

export interface Recommendation {
  shipment_id: string
  priority: Priority
  weights: Weights
  constraints: { max_transit_days: number; budget_usd: number; hazardous: boolean }
  recommended_route_id: string
  recommended_route_name: string
  no_feasible_route: boolean
  explanation: string
  routes: RouteEvaluation[]
}

export interface RecommendRequest {
  shipment_id: string
  priority?: Priority
  weights?: Weights
  max_transit_days?: number
  budget_usd?: number
}

export interface Sensitivity {
  shipment_id: string
  base_route_id: string
  base_weights: Weights
  score_margin: number | null
  weight_delta: number
  weight_scenarios: { name: string; weights: Weights; recommended_route_id: string; same_as_base: boolean }[]
  weight_stability: number
  monte_carlo: {
    n_samples: number
    seed: number
    base_pick_win_rate: number
    route_win_rates: Record<string, number>
  }
  verdict: Verdict
  summary: string
}

export type Strategy = "system" | "always_cheapest" | "always_fastest" | "always_safest"

export interface StrategySummary {
  strategy: Strategy
  sound_decision_rate: number
  constraint_satisfaction_rate: number
  pareto_optimal_rate: number
  avg_freight_premium_pct: number
  avg_expected_cost_premium_pct: number
  avg_extra_days_vs_fastest: number
  avg_delay_probability: number
  avg_geopolitical_risk: number
}

export interface Evaluation {
  n_shipments: number
  no_feasible_route_count: number
  weight_stability_rate: number
  strategies: StrategySummary[]
  shipments: {
    shipment_id: string
    priority: Priority
    no_feasible_route: boolean
    system_route_id: string
    cheapest_route_id: string
    fastest_route_id: string
    safest_route_id: string
    system_feasible: boolean
    weight_stable: boolean
  }[]
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Empty base = same origin (Vite proxies /api to FastAPI in dev).
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? ""

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    })
  } catch {
    throw new ApiError(0, "Cannot reach the API. Is the backend running on port 8000?")
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      message = body?.error?.message ?? (Array.isArray(body?.detail) ? body.detail[0]?.msg : body?.detail) ?? message
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: (signal?: AbortSignal) => request<{ status: string }>("/health", { signal }),
  listShipments: (signal?: AbortSignal) => request<ShipmentSummary[]>("/api/shipments", { signal }),
  getShipment: (id: string, signal?: AbortSignal) =>
    request<ShipmentDetail>(`/api/shipments/${encodeURIComponent(id)}`, { signal }),
  weightPresets: (signal?: AbortSignal) => request<Record<Priority, Weights>>("/api/weights/presets", { signal }),
  recommend: (body: RecommendRequest, signal?: AbortSignal) =>
    request<Recommendation>("/api/recommend", { method: "POST", body: JSON.stringify(body), signal }),
  sensitivity: (id: string, signal?: AbortSignal) =>
    request<Sensitivity>(`/api/shipments/${encodeURIComponent(id)}/sensitivity`, { signal }),
  evaluate: (signal?: AbortSignal) => request<Evaluation>("/api/evaluate", { signal }),
}
