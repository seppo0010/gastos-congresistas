# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Monorepo with two parts:

- **`web/`** — the React + TypeScript site (`cuantodeben.visualizando.ar`) that visualizes BCRA "Central de Deudores" debt records for Argentine congressional legislators, officials, judges, and JGM appointees. See `web/CLAUDE.md` for the frontend-specific guide.
- **Everything else at the repo root** — a Python data pipeline that downloads/parses raw BCRA, ArgentinaDatos, mapadelestado, and judicial source data, enriches it, and writes the JSON files `web/` reads at build time (`web/public/*.json`, which ARE committed — everything else this pipeline touches is raw/intermediate data and is gitignored, see below).

## Commands

```bash
# Setup (Python 3.11)
pipenv install --python 3.11
pipenv shell

# Run the full monthly pipeline (downloads reminders → freshness checks → parse → enrich → copy to web/public)
./update.sh

# Web app (see web/CLAUDE.md for details)
cd web && npm run dev
```

No test framework or linter is configured for the Python side.

## Pipeline architecture

`update.sh` is the orchestrator. It fails fast (no silent stale data) if IPC, ArgentinaDatos, políticos (mapadelestado), or BCRA DEUDORES/24DSF inputs look out of date, then runs, in order:

```
scripts/history.py                        → historial_legisladores_completo.csv (from *_argentinadatos.json)
scripts/parse_bcra_file.py (×4)            → legisladores2025/, politicos/, judicial/, jgm/ per-CUIT JSON, from bcra/*DEUDORES + bcra/24DSF*
scripts/merge.py                           → legisladores_enrich_final.json, politicos_enrich_final.json,
                                              judicial_enrich_final.json, jgm_enrich_final.json
scripts/bcra_preferido_b.py                → preferido_b_deudores.csv(.zip)  (separate report, not part of web/ output)
jq → web/public/{legisladores,politicos,judicial,jgm}_full.json
```

## Key scripts (all in `scripts/`)

- **clean.py** — Parses BCRA PDFs using `pdfplumber` for the original `diputados2023/`/`senadores2023/` batches. Extracts legislator CUIT, name, and 24-month debt history per bank entity.
- **history.py** — Processes ArgentinaDatos JSON files into a CSV of political events: initial appointments, party/block switches, mandate endings.
- **parse_bcra_file.py** — Parses the raw fixed-width `24DSF.txt`/`Maeent.txt` BCRA extracts for a given CUIT list, used for legisladores, políticos, judicial (magistrados federales), and JGM.
- **merge.py** — The main enrichment script: matches legislator names across sources (token inclusion → fuzzy match ≥0.85 → manual exception overrides), attaches `hitos_personales`, detects `posible_credito`/`cambios_nivel` anomalies, normalizes by MEP/IPC. Auto-detects the latest BCRA period (`bcra/*DEUDORES`) and magistrados CSV by glob instead of hardcoded filenames.
- **bcra_preferido_b.py** — Generates a CSV of everyone with "garantías preferidas B" in the BCRA, cross-referenced against legisladores/políticos/judicial. Auto-detects the latest DEUDORES/PADRON snapshot by glob.
- **auditar_duplicados.py** — Flags suspicious near-duplicate debt entries across entities.
- **parse_judicial_pdf.py**, **parse_padron.py**, **build_padron_index.py**, **search_padron.py**, **detect_new_hipotecas.py** — supporting tools for judicial PDFs and the padrón lookup index.

## Data directory conventions (all gitignored, see below)

- `diputados2023/`, `senadores2023/` — Original BCRA PDF batches, organized by month
- `legisladores2025/`, `politicos/`, `judicial/`, `jgm/`, `familiares/` — Per-CUIT JSON from `parse_bcra_file.py`, organized by month subfolder (e.g. `jun2026/`)
- `bcra/` — Raw downloaded BCRA extracts (`24DSF<periodo>/`, `<periodo>DEUDORES/`, `<fecha>PADRON/`) — hundreds of GB, never committed
- `padron/`, `padron2/`, `padron_index.db` — CUIT→name lookup index built from the padrón
- `cache_matches_nombres.json` — Persistent name-match cache for `merge.py`; edit manually to override bad matches

## What's tracked in git vs gitignored

Only code (`scripts/*.py`, `scripts/*.mjs`, `Pipfile`/`Pipfile.lock`, everything under `web/` except `node_modules`/`dist`) plus `web/public/*.json` (the actual deployed data), `diputados_argentinadatos.json`/`senadores_argentinadatos.json` (small ArgentinaDatos snapshots), and a couple of previously-tracked judicial PDF subdirectories are committed. Everything else the pipeline reads or writes at the repo root (`bcra/`, `padron*/`, `*_enrich_final*.json`, `legisladores_full.json`, notebooks, etc.) is gitignored — see the "Pipeline" section of `.gitignore`. Don't `git add -f` those without a good reason; they're large, regenerable, and some (raw BCRA dumps) are effectively unbounded in size.
