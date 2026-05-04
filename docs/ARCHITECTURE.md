# IFF Unified Platform — Architecture v1.0

**One platform. Four data planes. Five user surfaces.**

This document is the single source of truth that connects:

- **Perplexity** — research, model validation, variable discovery, market scanning
- **Snowflake** — system of record (`IFF_SEAFOOD` DB, 92 connectors, 20 forecast models, 8 composite signals, 12 Granger patterns, 12 tariff scenarios)
- **GitHub** — code, models, CI/CD (`indigenousfishersfirst/*` repos)
- **Cloudflare** — edge compute & delivery (Workers, D1, R2, KV, Queues, Durable Objects, Pages)

---

## 1 · Design principles

1. **Snowflake is the authority.** All durable facts live there. Cloudflare D1 is a read-cache, never a primary.
2. **The Worker is the only gateway.** Every frontend talks to one URL: `api.cantekhi.com`. No frontend ever calls Snowflake directly.
3. **One contract for every signal.** CS01-CS08, M01-M20 (and the v3 ARIMA-X / PCA-VAR / arbitration trio M11/M16/M19), TS-001-TS-012, and the 28 hidden indicators all serialize to the same JSON envelope.
4. **The 5 portals share one design system.** Different audiences, identical primitives.
5. **Perplexity is a producer.** It writes to `RESEARCH.VARIABLES`, `RESEARCH.HYPOTHESES`, and `RESEARCH.SCANS`. The model team promotes findings into `OPS.MODEL_COEFFICIENTS`.
6. **Auction state is a Durable Object.** The only mutable hot-path that doesn't live in Snowflake.
7. **Everything is reversible.** Versioned deploys, idempotent migrations, role-scoped reads.

---

## 2 · Domain map

```
                       ┌─────────────────────────────────────┐
                       │         api.cantekhi.com            │
                       │     (Cloudflare Worker · gateway)   │
                       └─────────────────────────────────────┘
                                       │
   ┌──────────────┬──────────────┬─────┴──────┬──────────────┬──────────────┐
   ▼              ▼              ▼            ▼              ▼              ▼
app.            auction.        chef.       market.        shop.         streamlit
cantekhi.com    cantekhi.com    cantekhi    cantekhi       cantekhi      (Snowsight)
HARVESTER       AUCTION         FOODSERVICE BOUTIQUE       CONSUMER      OPERATOR
                                                                          (internal)

Pages projects (Cloudflare Pages, Git-connected):
- iff-harvester       → app.cantekhi.com
- iff-auction         → auction.cantekhi.com
- iff-chef            → chef.cantekhi.com
- iff-market          → market.cantekhi.com
- iff-shop            → shop.cantekhi.com
- iff-app-git (kept)  → iff-app-git.pages.dev (operator/investor view)
- iff-app-2mw (kept)  → iff-app-2mw.pages.dev (v3 market intelligence)
```

The two existing Pages deployments (`iff-app-git.pages.dev`, `iff-app-2mw.pages.dev`) keep their roles — operator/investor and market intelligence — and are read-only consumers of the same `api.cantekhi.com` endpoints.

---

## 3 · Data plane responsibilities

| Plane         | Owns                                                                 | Writes                          | Reads                          |
|---------------|----------------------------------------------------------------------|---------------------------------|--------------------------------|
| **Snowflake** | Prices, signals, model coefficients, lots, harvesters, settlements   | Worker via REST API; Workers via `snowflake-sync.js`; Streamlit | Streamlit, Worker via `snowflake-sync.js` |
| **D1 (edge)** | Read cache of hot tables (last 30d prices, live auctions, signals)   | Worker (sync job, every 5 min)  | Every frontend route           |
| **R2**        | Static assets, traceability photos, audio stories, model artifacts (parquet), QR landing pages | Workers AI, ingest workers      | Pages, Workers AI              |
| **KV**        | Session tokens, rate limits, idempotency keys, ephemeral cache       | Worker                          | Worker                         |
| **Queues**    | Background jobs (signal recompute, settlement, notifications, sync)  | Worker, scheduled triggers      | Worker consumers               |
| **Durable Objects** | Live auction room state, real-time bid broadcast               | `auction.js` route              | WebSocket clients              |
| **GitHub**    | Source code, model notebooks, variable database, CI/CD pipeline      | Developers                      | Cloudflare Pages, Snowflake (model uploads) |
| **Perplexity**| Research scans, variable hypotheses, competitor intel, model validation | `iff-research-bridge` worker | Snowflake `RESEARCH.*` schema  |

---

## 4 · Unified signal envelope

**Every** signal — CS01–CS08, M11/M16/M19, TS-001–TS-012, the 28 hidden indicators, the 12 Granger patterns — serializes through one JSON shape so every frontend renders them with the same components.

```json
{
  "id": "CS04",
  "kind": "composite",                // composite | model | tariff | indicator | pattern
  "name": "Arbitrage Opportunity Score",
  "as_of": "2026-05-04T18:00:00Z",
  "horizon": "weekly",
  "score": 84,
  "score_scale": "0-100",
  "action": "BUY",                    // BUY | HOLD | SELL | MONITOR | null
  "confidence": 0.84,
  "regime": "harvest",                // harvest | inventory | replacement | null
  "scope": { "species": "DUNGENESS", "market": "CN_HK", "lane": "YVR-PVG" },
  "drivers": [
    { "name": "spread_usd_per_lb",    "value": 6.2,  "weight": 0.40 },
    { "name": "tariff_risk_0to1",     "value": 0.12, "weight": 0.30 },
    { "name": "transit_reliability",  "value": 0.91, "weight": 0.20 },
    { "name": "liquidity_score_0to1", "value": 0.78, "weight": 0.10 }
  ],
  "narrative": "China lobster talks (TS-001 92%) widen DUNGENESS substitution arb.",
  "source_models": ["CS04", "TS-001"],
  "evidence_urls": ["https://...", "snowflake://OPS.PRICE_FORECASTS#abc123"],
  "version": "v3.2"
}
```

This envelope lives at `Snowflake.OPS.SIGNALS_FEED` (materialized view) and in D1 `signals_cache` (last 7 days).

---

## 5 · Five user surfaces, one component library

| Portal              | Subdomain               | Audience               | Top jobs                                                                      |
|---------------------|-------------------------|------------------------|-------------------------------------------------------------------------------|
| Harvester Dashboard | `app.cantekhi.com`      | Skippers, deckhands    | See live ex-vessel offers, log catch, accept settlement, see HQS score        |
| Auction Marketplace | `auction.cantekhi.com`  | Wholesalers, brokers   | Bid live (Dutch/timed/sealed), Run Room, watchlist, settlements               |
| Foodservice (Chef)  | `chef.cantekhi.com`     | Restaurants, hotels    | RFQ, weekly availability, cultural product stories, traceability, scheduled buys |
| Boutique Grocer     | `market.cantekhi.com`   | Independent grocers    | Reserved cases, flyer-ready assets, provenance QR, retail-ready packs         |
| Premium Consumer    | `shop.cantekhi.com`     | DTC consumers          | CSF subscriptions, gift packs (ikura, salmon candy), recipes, traceability    |

All five frontends are built from a shared component library at `iff-apps/_shared/` (one design token file, one button, one signal card, one auction widget). Different portals just compose them differently.

The two **internal** surfaces stay where they are:

- `iff-app-git.pages.dev` — operator/investor dashboard (M11/M16/M19 + DSCR sensitivity)
- `iff-app-2mw.pages.dev/v32/` — full market intelligence cockpit (16 tabs, CS01–CS08, TS-001–TS-012, 28 indicators)
- Snowflake Streamlit (`IFF_SEAFOOD.OPS.IFF_SEAFOOD_APP`) — the operator console (15 tabs in v2)

All three internal surfaces share the same Worker API, so a number you see on one always equals the number on the other.

---

## 6 · Repository structure (monorepo on GitHub)

```
github.com/indigenousfishersfirst/iff-platform-monorepo
├── iff-platform/             ← THE Worker (single deploy)
│   ├── src/
│   │   ├── index.js          ← Hono router + cron + queue consumers
│   │   ├── middleware/
│   │   │   ├── auth.js       ← Clerk JWT verify, role gate
│   │   │   ├── rate-limit.js ← KV-backed
│   │   │   └── logger.js     ← Tail to Logpush
│   │   ├── routes/
│   │   │   ├── signals.js
│   │   │   ├── lots.js
│   │   │   ├── auctions.js
│   │   │   ├── traceability.js
│   │   │   ├── settlements.js
│   │   │   ├── research.js   ← Perplexity bridge
│   │   │   └── public.js     ← QR landing pages
│   │   ├── modules/
│   │   │   ├── consensus-engine.js
│   │   │   ├── signal-arbitrator.js   ← M19 logic generalized to all CS/M models
│   │   │   ├── traceability.js
│   │   │   ├── auction.js
│   │   │   ├── ingest-snowpack.js
│   │   │   ├── ingest-chlorophyll.js
│   │   │   ├── ingest-toyosu.js
│   │   │   ├── ingest-norwegian-salmon.js
│   │   │   ├── ingest-diesel-nrcan.js
│   │   │   ├── ingest-google-trends.js
│   │   │   └── snowflake-sync.js      ← bidirectional D1 ↔ Snowflake
│   │   ├── durable-objects/
│   │   │   └── auction-room.js        ← live bid broadcasting
│   │   └── lib/
│   │       ├── snowflake.js           ← REST helper, retries, batch insert
│   │       ├── d1.js
│   │       ├── envelope.js            ← signal envelope builder + validator
│   │       └── perplexity.js
│   ├── migrations/
│   │   ├── 0001_signals_cache.sql
│   │   ├── 0002_lots_cache.sql
│   │   ├── 0003_auctions.sql
│   │   └── 0004_users_sessions.sql
│   ├── wrangler.toml
│   └── package.json
│
├── iff-apps/                 ← All 5 frontends in one tree
│   ├── _shared/              ← design tokens, components, hooks
│   │   ├── tokens.ts         ← color, type, spacing
│   │   ├── components/{Button,SignalCard,AuctionCard,LotTable,QRBlock}.tsx
│   │   ├── hooks/{useSignal,useAuction,useLot}.ts
│   │   └── api.ts            ← typed client for api.cantekhi.com
│   ├── harvester-dashboard/  ← Next.js, deployed to app.cantekhi.com
│   ├── auction-marketplace/  ← Next.js, deployed to auction.cantekhi.com
│   ├── chef-portal/          ← Next.js, deployed to chef.cantekhi.com
│   ├── market-portal/        ← Next.js, deployed to market.cantekhi.com
│   └── consumer-shop/        ← Next.js, deployed to shop.cantekhi.com
│
├── iff-models/               ← Python ML (run in Snowflake or locally)
│   ├── notebooks/
│   │   ├── M01_short_horizon_xgboost.ipynb
│   │   ├── M11_arima_x.ipynb
│   │   ├── M16_pca_var.ipynb
│   │   ├── M19_arbitration.ipynb
│   │   └── ... M20
│   ├── composite/
│   │   ├── CS01_harvest_pressure.py
│   │   ├── CS02_demand_pull.py
│   │   ├── CS03_margin_capture.py
│   │   ├── CS04_arbitrage.py
│   │   ├── CS05_inventory_carry.py
│   │   ├── CS06_substitution_risk.py
│   │   ├── CS07_fuel_effort.py
│   │   └── CS08_cultural_demand.py
│   ├── granger/              ← 12 lead-lag patterns from v3 Tab 9
│   │   ├── P01_pdo_sockeye.py
│   │   ├── P02_diesel_wholesale.py
│   │   └── ... P12
│   ├── variable_database.csv ← single registry of every input variable
│   ├── tests/
│   └── publish.py            ← writes coefficients to OPS.MODEL_COEFFICIENTS
│
├── iff-snowflake/            ← all SQL (idempotent), Streamlit app
│   ├── sql/
│   │   ├── 01_environmental_sources.sql
│   │   ├── 02_market_geopolitical_sources.sql
│   │   ├── 03_marketplace_layer.sql
│   │   ├── 04_ops_views_and_coefficients.sql
│   │   ├── 05_research_schema.sql        ← NEW: Perplexity bridge
│   │   ├── 06_signals_feed.sql           ← NEW: unified envelope view
│   │   └── 07_grants_and_roles.sql
│   └── streamlit/streamlit_app_v2.py     ← 15-tab operator console
│
└── .github/workflows/
    ├── deploy-worker.yml         ← wrangler deploy on push to main
    ├── deploy-pages.yml          ← matrix-deploy 5 apps
    ├── snowflake-migrate.yml     ← run sql/*.sql via snowsql on tagged release
    ├── models-publish.yml        ← run iff-models/publish.py nightly
    └── ci.yml                    ← lint, test, typecheck
```

---

## 7 · End-to-end data flow (one example)

**Scenario:** PDO index updates monthly → CS01 score recomputes → harvester sees new dock signal.

```
1. Cron (1st of month, 01:00 UTC) fires in iff-platform Worker
2. modules/ingest-pdo.js fetches NCEI PDO file
3. lib/snowflake.js MERGEs into SOURCES.RAW_PDO_INDEX
4. Queue job "recompute-signals" enqueued
5. Consumer pulls latest features from OPS.V_FEATURES_LATEST
6. modules/consensus-engine.js runs CS01..CS08 with new PDO value
7. Results written to OPS.SIGNALS_FEED (Snowflake)
8. snowflake-sync.js MERGEs delta into D1 signals_cache (5-min sync)
9. Harvester app polls /v1/signals?species=SOCKEYE
10. Worker serves from D1 in <50 ms; SignalCard renders with new score
11. If action flips to BUY → Twilio SMS via Queues to subscribed harvesters
```

Same data, same envelope, same component renders it on `iff-app-git.pages.dev` for the investor view, on `iff-app-2mw.pages.dev/v32` for the market cockpit, and inside the Snowflake Streamlit app.

---

## 8 · The Perplexity bridge

Perplexity becomes a first-class data producer through a thin worker.

| Direction               | What flows                                      | Where it lands                                      |
|-------------------------|-------------------------------------------------|-----------------------------------------------------|
| Perplexity → Snowflake  | Research scans (competitors, regulations, news) | `RESEARCH.SCANS` (raw + structured)                 |
| Perplexity → Snowflake  | New variable hypotheses (e.g. "fuel-share suppression score")| `RESEARCH.VARIABLES` (proposed; team promotes to `MODEL_COEFFICIENTS`) |
| Perplexity → Snowflake  | Competitor pricing intel                        | `RESEARCH.COMPETITORS`                              |
| Perplexity → Snowflake  | Regulatory updates (DFO, CFIA, USTR, MOFCOM)    | `RESEARCH.REGULATORY` → triggers tariff scenario rebuild |
| Snowflake → Perplexity  | Open hypotheses + recent forecasts              | Prompt context for next research cycle              |

The bridge is a small worker (`/iff-platform/src/routes/research.js`) that:
1. Receives webhook from a scheduled Perplexity research session
2. Validates and parses the structured output
3. Writes via `snowflake.js` REST helper
4. Posts a Slack notification to `#consulting-projects-`

---

## 9 · Authentication & roles

One IDP — Clerk — issues JWTs verified by the Worker middleware.

| Role            | Scope                                                            |
|-----------------|------------------------------------------------------------------|
| `iff_admin`     | Everything; can write to Snowflake; can promote research         |
| `iff_operator`  | Read all; write to lots, settlements, traceability               |
| `nation_admin`  | Read/write only their nation's lots, harvesters, cultural registry |
| `harvester`     | Read/write their own lots, see HQS, accept offers                |
| `buyer_tier1`   | Bid on all lot types incl. Run Room and pre-season shares        |
| `buyer_tier2`   | Bid on A_SPOT and D_CSF_SHARE; member of CSF                     |
| `buyer_tier3`   | Bid on A_SPOT only                                               |
| `consumer`      | Browse and buy from `shop.cantekhi.com`; see traceability         |
| `chef`          | RFQ, scheduled buys, cultural products on `chef.cantekhi.com`     |
| `grocer`        | Reserved cases + flyer assets on `market.cantekhi.com`            |
| `viewer`        | Read-only; matches existing `viewer/view123` legacy login        |
| `investor`      | Read DSCR, fleet, financials; mirrors `iff-app-git.pages.dev`     |

---

## 10 · Versioning & rollout

- Worker: `wrangler deploy --env=production`; canary via `--env=canary` and 10% routing rule
- Pages: branch-based; `main` → production, every PR gets a preview URL
- Snowflake SQL: tagged releases; `snowflake-migrate.yml` runs them in order via `snowsql`
- Models: nightly `models-publish.yml` updates `OPS.MODEL_COEFFICIENTS` with version stamp

Existing surfaces stay live during the cutover. Migration order:

1. Stand up `api.cantekhi.com` Worker reading from current Snowflake
2. Migrate `iff-app-git.pages.dev` to call the Worker (no UI change)
3. Migrate `iff-app-2mw.pages.dev/v32/` to call the Worker
4. Launch `app.cantekhi.com` (harvester) — first new portal
5. Launch `auction.cantekhi.com`
6. Launch `chef.`, `market.`, `shop.` in that order

Every step is independently revertable by flipping a Pages deployment back to its prior commit.
