# IFF Unified Platform

**Indigenous Fishers First — single integrated stack connecting Perplexity research, Snowflake warehouse, GitHub source, and Cloudflare edge into 5 user portals plus an operator/investor view.**

```
iff-app-2mw.pages.dev/v32  ← market intel reference (existing)
iff-app-git.pages.dev      ← operator/investor reference (existing)
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│   PERPLEXITY    →    SNOWFLAKE    →    GITHUB    →    CLOUDFLARE
│   (research)         (warehouse)       (source)        (edge)
│                                                           │
│   • scans            • IFF_SEAFOOD     • iff-platform    • Worker
│   • variables          - RAW           • iff-apps          api.cantekhi.com
│   • regulatory         - OPS           • iff-models      • 5 Pages
│                        - ANALYTICS                         app · auction
│                        - MARKETPLACE                       chef · market
│                        - RESEARCH                          shop
└───────────────────────────────────────────────────────────┘
```

## Repo layout

```
iff_unified_platform/
├── docs/
│   └── ARCHITECTURE.md                # master architecture spec
├── iff-platform/                      # Cloudflare Worker (api.cantekhi.com)
│   ├── src/
│   │   ├── index.js                   # Hono router
│   │   ├── lib/                       # snowflake, envelope, scheduler, queue
│   │   ├── middleware/                # auth, rate-limit, logger
│   │   ├── routes/                    # signals, lots, auctions, traceability, settlements, research, public
│   │   ├── modules/                   # consensus, sync, auction watchdog, settlements, research, ingest, traceability, granger, forecast, tariff, notifications
│   │   └── durable-objects/           # auction-room (live bidding)
│   ├── migrations/                    # D1 schema (4 files)
│   ├── wrangler.toml
│   └── package.json
├── iff-apps/                          # 5 Cloudflare Pages portals
│   ├── _shared/                       # tokens.css, iff-api.js (single design system + API client)
│   ├── harvester-dashboard/           # app.cantekhi.com
│   ├── auction-marketplace/           # auction.cantekhi.com
│   ├── chef-portal/                   # chef.cantekhi.com
│   ├── market-portal/                 # market.cantekhi.com
│   └── consumer-shop/                 # shop.cantekhi.com
├── iff-snowflake/
│   ├── sql/                           # 00_init, 01_marketplace, 05_research, 06_signals_feed, 07_grants
│   └── streamlit/                     # operator dashboard inside Snowflake
├── iff-models/                        # weekly model publishing
│   ├── variable_database.csv          # canonical registry of all 30+ variables
│   ├── granger_causality_tests/       # P01-P12 pattern tests
│   ├── models/                        # M11 ARIMA-X, M16 PCA-VAR, M19 arbitrator
│   ├── publish.py
│   └── requirements.txt
└── .github/workflows/
    ├── deploy-worker.yml              # push iff-platform/** → Worker
    ├── deploy-pages.yml               # push iff-apps/** → 5 portals (matrix)
    ├── snowflake-migrate.yml          # push iff-snowflake/sql/** → Snowflake
    ├── models-publish.yml             # weekly cron → Granger + forecasts → Snowflake
    └── ci.yml
```

## How the four planes connect

1. **Perplexity → Snowflake.** The Worker calls Perplexity, persists every scan to `RESEARCH.SCANS`, extracts quantitative variables to `RESEARCH.VARIABLES`, and (when validated) promotes them to `OPS.SIGNALS_FEED` so they can drive Granger tests and consensus signals.

2. **Snowflake → Cloudflare.** Every 5 minutes, the Worker pulls the latest `OPS.V_SIGNALS_LATEST` and `MARKETPLACE.LOTS` into D1 cache. Frontends read D1 (low-latency edge) and the Worker fans out signal updates over WebSockets to live auction rooms.

3. **GitHub → all of the above.** Pushes to `iff-platform/**` deploy the Worker; pushes to `iff-apps/**` deploy the 5 Pages portals via a single matrix workflow; pushes to `iff-snowflake/sql/**` apply migrations; the weekly `models-publish` workflow runs `iff-models/publish.py` against Snowflake and posts a refresh ping to the Worker.

4. **Cloudflare → Snowflake.** Worker writes flow back: every lot, lot event, bid, settlement, scan, and trace event is written through to Snowflake, plus mirrored into D1. Snowflake remains the system of record; D1 is a read-through cache.

5. **Streamlit cross-link.** The Snowflake Streamlit app (`iff-snowflake/streamlit/app.py`) reads `V_SIGNALS_LATEST` directly and includes deep links into all 5 Cloudflare portals plus the existing `iff-app-2mw` market intel and `iff-app-git` investor dashboards — so an operator inside Snowflake can drill into any live UI in one click.

## Single signal envelope

Everything that flows between planes uses one JSON shape (defined in `iff-platform/src/lib/envelope.js` and `OPS.SIGNALS_FEED.ENVELOPE`):

```json
{
  "envelope_version": "1.0",
  "signal_id": "CS01",                    
  "kind": "composite",                     
  "species": "sockeye",
  "value": 18.95,
  "unit": "CAD/kg",
  "confidence": 0.82,
  "direction": "up",
  "inputs": { "...": "..." },
  "sources": [{ "kind": "toyosu", "id": "..." }],
  "computed_at": "2026-05-04T15:00:00Z"
}
```

This makes CS01-CS08 composite signals, M01-M20 model forecasts, TS-001-TS-012 tariff scenarios, P01-P12 Granger patterns, and 28 hidden indicators interchangeable — any frontend can render any of them with the same component.

## Five portals, one design system

All 5 Pages projects share `iff-apps/_shared/`:
- `tokens.css` — colors, type, spacing, motion (single source of truth)
- `iff-api.js` — the only API client, used in every portal
- `iff-header.html` — global navigation

Each portal is a simple static `index.html` that loads tokens.css and uses the shared API. They feel like one product because they literally share the same CSS variables and components.

## Quick start

```bash
# 1. Snowflake
cd iff-snowflake/sql
# Run 00_init.sql → 01_marketplace.sql → 05_research_schema.sql → 06_signals_feed.sql → 07_grants_and_roles.sql

# 2. Cloudflare Worker
cd iff-platform
npm install
wrangler d1 create iff_platform_db
wrangler kv:namespace create IFF_KV
wrangler r2 bucket create iff-research-cache
wrangler queues create iff-signals
# Update IDs in wrangler.toml, then:
npm run db:migrate:remote
npm run deploy

# 3. Cloudflare Pages (5 portals)
# Push to GitHub main → deploy-pages.yml does the matrix deploy

# 4. Models
cd iff-models
pip install -r requirements.txt
python publish.py  # one-shot test; weekly cron in models-publish.yml
```

See `DEPLOYMENT.md` for full step-by-step.

## Existing artifacts kept

- `iff-app-2mw.pages.dev/v32/` — the v32 market-intel app stays as the public investor/market view; the new `shop.cantekhi.com` reuses its product catalog references.
- `iff-app-git.pages.dev` — the operator/investor financial dashboard stays as-is; the new Streamlit app at `app.snowflake.com/yshoftq/ql22196/#/streamlit-apps` reads from the same Snowflake tables and links across.
- `iff_app_upgrade_v2.zip` — the v2 SQL kit is referenced from `iff-snowflake/sql/01_marketplace.sql` and superseded by 05/06/07 in this kit.

## Roles

| Role             | Access                                                   |
|------------------|----------------------------------------------------------|
| iff_admin        | full read/write everywhere                                |
| iff_operator     | read all, write OPS + MARKETPLACE + RESEARCH              |
| nation_admin     | read all, write own Nation rows                           |
| harvester        | read prices/forecast, write own lots + lot events         |
| buyer_tier1/2/3  | read prices, place bids                                   |
| chef             | read available lots, place reservations                   |
| grocer           | read case packs, schedule deliveries                      |
| consumer         | read public catalog, trace own orders                     |
| viewer/investor  | read-only                                                 |

Roles are enforced at the Worker (Clerk JWT) and at Snowflake (IFF_*_ROLE grants).
