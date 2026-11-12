# Frontend: Route Advisor UI

React 19 + TypeScript + Vite, styled with Tailwind CSS and shadcn/ui. See the [project README](../README.md) for the full picture.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

The backend must be running at `http://127.0.0.1:8000`. In development, Vite forwards `/api` and `/health` to it (see [vite.config.ts](vite.config.ts)), so the browser talks to one origin.

To point a production build at another backend, set `VITE_API_URL` before building:

```bash
VITE_API_URL=https://api.example.com npm run build
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the built app |
| `npm run lint` | Lint with oxlint |

## Structure

```
src/
  App.tsx                 page layout, data loading, tabs
  components/
    ShipmentBar.tsx       shipment picker, limits, the four goal cards
    AnswerCard.tsx        the recommendation, why, how sure, journey
    OptionCards.tsx       every route with its status
    CriteriaPanel.tsx     weight sliders and what-if deadline / budget
    TradeoffChart.tsx     cost vs expected days
    SensitivityCard.tsx   weight scenarios and Monte Carlo result
    RouteTable.tsx        full scoring table
    EvaluationView.tsx    "How well it works" tab
    ui/                   shadcn/ui primitives
  lib/
    api.ts                typed client; types mirror backend/schemas/*.py
    format.ts             money, days, percentages
    plain.ts              plain-English labels and reasons
```

Useful URLs: `?shipment=SHP-008` opens a shipment; `#evaluate` opens the evaluation tab.
