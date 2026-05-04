# IFF Unified Platform — Deployment Guide

This guide takes you from a fresh GitHub repo to a fully running platform across Snowflake + Cloudflare in roughly 90 minutes.

## 1. Prerequisites

- Cloudflare account with `cantekhi.com` already added (Workers + Pages enabled)
- Snowflake account `yshoftq-ql22196` (already in use)
- GitHub org `indigenousfishersfirst` with repo `iff-platform-monorepo`
- Clerk app for authentication (or skip and use API keys only)
- Stripe account for settlements (optional for MVP)
- Perplexity API key (for research bridge)

## 2. Snowflake bootstrap

```bash
cd iff-snowflake/sql
# Run as ACCOUNTADMIN in Snowflake worksheet, in order:
# 00_init.sql
# 01_marketplace.sql
# 05_research_schema.sql
# 06_signals_feed.sql
# 07_grants_and_roles.sql
```

Then create the service user (uncomment block at bottom of `07_grants_and_roles.sql`) — set a strong password and store it as a GitHub secret named `SNOWFLAKE_PASSWORD`.

Upload `iff-snowflake/streamlit/app.py` to the Streamlit app at  
`https://app.snowflake.com/yshoftq/ql22196/#/streamlit-apps`.

## 3. Cloudflare Worker

```bash
cd iff-platform
npm install
wrangler login

# Create resources (one-time)
wrangler d1 create iff_platform_db          # copy ID into wrangler.toml
wrangler kv:namespace create IFF_KV         # copy ID
wrangler r2 bucket create iff-research-cache
wrangler queues create iff-signals
wrangler queues create iff-settlements
wrangler queues create iff-research

# Run migrations
wrangler d1 migrations apply iff_platform_db --remote

# Set secrets
wrangler secret put SNOWFLAKE_ACCOUNT       # yshoftq-ql22196
wrangler secret put SNOWFLAKE_USER          # IFF_WORKER_SVC
wrangler secret put SNOWFLAKE_PASSWORD
wrangler secret put CLERK_JWT_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put PERPLEXITY_API_KEY
wrangler secret put SLACK_WEBHOOK_URL

# Deploy
wrangler deploy
```

Bind the custom domain `api.cantekhi.com` in the Cloudflare dashboard:  
*Workers & Pages → iff-platform → Triggers → Custom Domains → Add `api.cantekhi.com`.*

## 4. Cloudflare Pages — 5 portals

In the Cloudflare dashboard, create 5 Pages projects:

| Project name      | Custom domain              |
|-------------------|----------------------------|
| iff-harvester     | app.cantekhi.com           |
| iff-auction       | auction.cantekhi.com       |
| iff-chef          | chef.cantekhi.com          |
| iff-market        | market.cantekhi.com        |
| iff-shop          | shop.cantekhi.com          |

After the first deploy, the matrix workflow `deploy-pages.yml` handles all subsequent updates automatically.

## 5. GitHub Actions secrets

Add these secrets to the repo (Settings → Secrets → Actions):

```
CLOUDFLARE_API_TOKEN        # Workers + Pages scope
CLOUDFLARE_ACCOUNT_ID
SNOWFLAKE_ACCOUNT
SNOWFLAKE_USER
SNOWFLAKE_PASSWORD
CLERK_JWT_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
PERPLEXITY_API_KEY
SLACK_WEBHOOK_URL
WORKER_API_KEY              # for models-publish.yml to ping Worker
```

## 6. First deploy

```bash
git init
git remote add origin git@github.com:indigenousfishersfirst/iff-platform-monorepo.git
git add .
git commit -m "Initial unified platform"
git push -u origin main
```

The push triggers all four deploy workflows in parallel:
- `deploy-worker.yml` → Worker
- `deploy-pages.yml`  → 5 portals
- `snowflake-migrate.yml` → schemas (idempotent)
- `models-publish.yml` is on cron only; you can dispatch it manually once.

## 7. Smoke test

```bash
curl https://api.cantekhi.com/v1/health
# → { "ok": true, "version": "1.0.0" }

curl https://api.cantekhi.com/v1/signals
# → { "signals": [...] }

# Visit each portal:
open https://app.cantekhi.com
open https://auction.cantekhi.com
open https://chef.cantekhi.com
open https://market.cantekhi.com
open https://shop.cantekhi.com
```

## 8. Operator handoff

- Snowflake operator dashboard: `app.snowflake.com/yshoftq/ql22196/#/streamlit-apps`
- Existing investor dashboard: `iff-app-git.pages.dev`
- Existing market intel: `iff-app-2mw.pages.dev/v32/`

These three keep working alongside the new portals — the Streamlit app cross-links to all of them.

## 9. Rollback

If a deploy goes bad:
```bash
# Worker
cd iff-platform && wrangler rollback

# Pages — Cloudflare dashboard → project → Deployments → "Rollback"
```

## 10. Common tweaks

- **Add a new species:** add row to `iff-models/variable_database.csv`, push. Models pick it up next Monday.
- **Activate a tariff scenario:** `POST /v1/tariff/scenarios/TS-001/activate` (admin only).
- **Promote a research variable:** `POST /v1/research/variables/{name}/promote` with `{"signal_id":"IND-XX"}`.
- **Add a portal:** copy any folder under `iff-apps/`, add a row to the matrix in `deploy-pages.yml`.
