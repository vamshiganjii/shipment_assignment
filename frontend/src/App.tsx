import { AlertTriangle, Moon, Route as RouteIcon, Sun } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { AnswerCard } from "@/components/AnswerCard"
import { CriteriaPanel, type Criteria } from "@/components/CriteriaPanel"
import { Disclosure } from "@/components/Disclosure"
import { EvaluationView } from "@/components/EvaluationView"
import { OptionCards } from "@/components/OptionCards"
import { RouteTable } from "@/components/RouteTable"
import { SensitivityCard } from "@/components/SensitivityCard"
import { ShipmentBar, type GoalPreview } from "@/components/ShipmentBar"
import { TradeoffChart } from "@/components/TradeoffChart"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAsync } from "@/hooks/useAsync"
import { api, type Priority, type RecommendRequest, type ShipmentDetail, type Weights } from "@/lib/api"
import { GOALS } from "@/lib/plain"

function useTheme() {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("theme")
      if (saved) return saved === "dark"
    } catch {
      // storage unavailable
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  })
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    try {
      localStorage.setItem("theme", dark ? "dark" : "light")
    } catch {
      // storage unavailable
    }
  }, [dark])
  return [dark, setDark] as const
}

const toSlider = (w: Weights): Weights => ({ cost: w.cost * 100, time: w.time * 100, risk: w.risk * 100, delay: w.delay * 100 })

function criteriaFor(priority: Priority, presets: Record<Priority, Weights>, keep?: Criteria): Criteria {
  return {
    priority,
    weights: toSlider(presets[priority]),
    custom: false,
    maxTransitDays: keep?.maxTransitDays ?? "",
    budgetUsd: keep?.budgetUsd ?? "",
  }
}

function buildRequest(id: string, c: Criteria): RecommendRequest {
  const req: RecommendRequest = { shipment_id: id, priority: c.priority }
  const sum = c.weights.cost + c.weights.time + c.weights.risk + c.weights.delay
  if (c.custom && sum > 0) req.weights = c.weights // backend normalises to 1
  if (Number(c.maxTransitDays) > 0) req.max_transit_days = Number(c.maxTransitDays)
  if (Number(c.budgetUsd) > 0) req.budget_usd = Number(c.budgetUsd)
  return req
}

/** Ask the backend what each goal recommends under the given limits. */
async function fetchGoalPreviews(req: RecommendRequest, signal: AbortSignal) {
  const entries = await Promise.all(
    GOALS.map(async (g) => {
      const r = await api.recommend({ ...req, priority: g.value }, signal)
      const best = r.routes.find((x) => x.route_id === r.recommended_route_id)!
      const preview: GoalPreview = {
        routeId: best.route_id,
        routeName: best.route_name,
        cost: best.total_cost_usd,
        days: best.expected_transit_days,
        geoRisk: best.geopolitical_risk,
      }
      return [g.value, preview] as const
    }),
  )
  return { shipmentId: req.shipment_id, previews: Object.fromEntries(entries) as Record<Priority, GoalPreview> }
}

/** The robustness check runs on the shipment's own settings; only show it when they're in use. */
function usesDefaults(c: Criteria, d: ShipmentDetail) {
  return c.priority === d.priority && !c.custom && !c.maxTransitDays && !c.budgetUsd
}

export default function App() {
  const [dark, setDark] = useTheme()
  // tab is mirrored in the URL hash so #evaluate can be linked directly
  const [tab, setTabState] = useState<string>(() => (window.location.hash === "#evaluate" ? "evaluate" : "recommend"))
  const setTab = (t: string) => {
    setTabState(t)
    window.history.replaceState(null, "", t === "evaluate" ? "#evaluate" : window.location.pathname)
  }
  // ?shipment=SHP-008 opens a specific shipment (handy for demos)
  const [shipmentId, setShipmentId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get("shipment") ?? undefined,
  )
  const [criteria, setCriteria] = useState<Criteria>()

  const shipments = useAsync((s) => api.listShipments(s), [])
  const presets = useAsync((s) => api.weightPresets(s), [])
  const detail = useAsync((s) => api.getShipment(shipmentId!, s), [shipmentId], !!shipmentId)
  const sensitivity = useAsync((s) => api.sensitivity(shipmentId!, s), [shipmentId], !!shipmentId)

  // default to the first shipment
  useEffect(() => {
    if (!shipmentId && shipments.data?.length) setShipmentId(shipments.data[0].shipment_id)
  }, [shipments.data, shipmentId])

  // start from the shipment's own priority whenever a new shipment loads
  useEffect(() => {
    if (detail.data && presets.data && detail.data.shipment_id === shipmentId) {
      setCriteria(criteriaFor(detail.data.priority, presets.data))
    }
  }, [detail.data, presets.data, shipmentId])

  const currentDetail = detail.data?.shipment_id === shipmentId ? detail.data : undefined
  const request = currentDetail && criteria ? buildRequest(shipmentId!, criteria) : undefined
  // debounce slider drags by 250 ms
  const rec = useAsync((s) => api.recommend(request!, s), [JSON.stringify(request ?? null)], !!request, 250)

  const recommendedRoute = useMemo(
    () => currentDetail?.routes.find((r) => r.route_id === rec.data?.recommended_route_id),
    [currentDetail, rec.data],
  )
  const recIsCurrent = rec.data?.shipment_id === shipmentId
  const currentSensitivity = sensitivity.data?.shipment_id === shipmentId ? sensitivity.data : undefined

  // What each goal picks with the shipment's own limits. The goal cards always show these, so the
  // comparison stays visible; what-if limits only mark which of them still fit and which one is picked.
  const baseline = useAsync((s) => fetchGoalPreviews({ shipment_id: shipmentId! }, s), [shipmentId], !!shipmentId)
  const previews =
    baseline.data && baseline.data.shipmentId === shipmentId ? baseline.data.previews : undefined
  const limits = currentDetail &&
    criteria && {
      maxTransitDays: Number(criteria.maxTransitDays) > 0 ? Number(criteria.maxTransitDays) : currentDetail.max_transit_days,
      budgetUsd: Number(criteria.budgetUsd) > 0 ? Number(criteria.budgetUsd) : currentDetail.budget_usd,
      overridden: Number(criteria.maxTransitDays) > 0 || Number(criteria.budgetUsd) > 0,
    }
  const fatal = shipments.error ?? presets.error

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--viz-series-1)] text-white">
            <RouteIcon className="size-4" />
          </div>
          <div className="mr-auto">
            <h1 className="text-sm font-semibold leading-tight">Route Advisor</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">Picks the best shipping route and explains why</p>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
            <TabsList>
              <TabsTrigger value="recommend">Recommend</TabsTrigger>
              <TabsTrigger value="evaluate">How well it works</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={() => setDark(!dark)}>
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {fatal ? (
          <Alert>
            <AlertTriangle className="text-[var(--status-critical)]" />
            <AlertTitle>Backend unavailable</AlertTitle>
            <AlertDescription>
              {fatal.message} Start it with <code className="font-mono">uvicorn main:app --reload</code> in the backend folder.
            </AlertDescription>
          </Alert>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
            <TabsContent value="recommend" className="space-y-6">
              <ShipmentBar
                shipments={shipments.data}
                selectedId={shipmentId}
                onSelect={(id) => {
                  setShipmentId(id)
                  setCriteria(undefined)
                }}
                detail={currentDetail}
                limits={limits || undefined}
                previews={previews}
                recommendedRouteId={recIsCurrent ? rec.data?.recommended_route_id : undefined}
                goal={criteria?.priority}
                customWeights={!!criteria?.custom}
                onGoal={(p) => presets.data && setCriteria(criteriaFor(p, presets.data, criteria))}
                routes={recIsCurrent ? rec.data?.routes : undefined}
              />

              {rec.error && (
                <Alert>
                  <AlertTriangle className="text-[var(--status-critical)]" />
                  <AlertTitle>Could not compute a recommendation</AlertTitle>
                  <AlertDescription>{rec.error.message}</AlertDescription>
                </Alert>
              )}

              {rec.data && recIsCurrent && criteria && currentDetail ? (
                <>
                  <AnswerCard
                    rec={rec.data}
                    route={recommendedRoute}
                    sensitivity={usesDefaults(criteria, currentDetail) ? currentSensitivity : undefined}
                    loading={rec.loading}
                  />
                  <OptionCards rec={rec.data} loading={rec.loading} />

                  <Disclosure
                    id="finetune"
                    title="Fine-tune the decision"
                    hint="Adjust exact weights, or test a different deadline or budget"
                  >
                    <CriteriaPanel
                      routes={rec.data.routes}
                      loading={rec.loading}
                      defaultRouteId={currentSensitivity?.base_route_id}
                      value={criteria}
                      onChange={setCriteria}
                      onReset={() => presets.data && setCriteria(criteriaFor(currentDetail.priority, presets.data))}
                      defaults={{ maxTransitDays: currentDetail.max_transit_days, budgetUsd: currentDetail.budget_usd }}
                    />
                  </Disclosure>

                  <Disclosure
                    boxed={false}
                    title="Show the analysis"
                    hint="Cost vs. time chart, robustness tests and full scoring, for analysts"
                  >
                    <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                      <TradeoffChart rec={rec.data} />
                      <SensitivityCard data={currentSensitivity} error={sensitivity.error} routes={rec.data.routes} />
                    </div>
                    <RouteTable routes={rec.data.routes} loading={rec.loading} />
                  </Disclosure>
                </>
              ) : (
                !rec.error && (
                  <div className="space-y-6">
                    <Skeleton className="h-80" />
                    <Skeleton className="h-48" />
                  </div>
                )
              )}
            </TabsContent>

            <TabsContent value="evaluate">
              <EvaluationView />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  )
}
