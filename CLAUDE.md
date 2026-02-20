# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A React + TypeScript web app that visualizes debt records from Argentina's Central Bank (BCRA) "Central de Deudores" for national legislators. Users can compare up to 4 legislators simultaneously, view debt history over time, and adjust for inflation (IPC) or USD (MEP exchange rate).

Deployed at: `https://seppo0010.github.io/gastos-congresistas/`

## Commands

```bash
npm run dev       # Start Vite dev server
npm run build     # tsc -b && vite build (TypeScript check + bundle)
npm run lint      # ESLint
npm run preview   # Preview production build locally
```

No test suite exists.

## Architecture

**Entry point**: `src/main.tsx` → `src/Dashboard.tsx` (root component)

**Component hierarchy**:
- `Dashboard.tsx` — owns all state: selected legislators (up to 4), URL query params for sharing, mobile/desktop layout toggle, currency mode
  - `LegislatorSelector.tsx` — left panel: search + filter list (by cargo/distrito/partido/credit status), sort options
  - `DebtChart.tsx` — right panel: Recharts bar chart of debt over time, milestones as reference lines, custom tooltip with per-bank breakdown

**Data loading**: `legisladores_full.json` (~4.2 MB) is imported statically at build time. No API calls at runtime.

**Data shape** (defined in `src/types.ts`):
- `DashboardData.meta` — global milestones (`hitos_globales`), IPC index, MEP rates (both keyed by `"YYYY-MM"`)
- `DashboardData.data` — array of `Legislator` objects
- Each `Legislator` has a flat `historial: DebtRecord[]` (raw, one record per bank per month), `hitos_personales`, and boolean flags `posible_crédito` / `cambios_nivel`
- `DebtRecord.monto` is in thousands of ARS; `situacion` is 1–5 (1=Normal, 5=Irrecuperable)
- Currency modes: `nominal` | `real` (IPC-adjusted) | `usd` (MEP-adjusted)

**URL state**: Legislator selections are encoded in query params so comparisons can be shared via link.

**Vite config**: base path is `/gastos-congresistas/` for GitHub Pages. Tailwind CSS 4 is used via the Vite plugin (not PostCSS).

**CI/CD**: `.github/workflows/deploy.yml` builds and deploys to GitHub Pages on push to `main`.

## Key data notes

- `posible_crédito` and `cambios_nivel` are heuristic flags computed when generating the JSON — they affect filter options in the selector
- `historial` is unsorted and unaggregated; the chart components aggregate by date
- `politicos_full.json` also exists in `src/` but may be an alternative/newer dataset
