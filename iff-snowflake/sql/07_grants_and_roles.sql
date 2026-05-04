-- =================================================================
-- 07_grants_and_roles.sql
-- Snowflake roles + grants for IFF unified platform.
-- Roles mirror the application role table:
--   IFF_ADMIN_ROLE      → iff_admin (full access)
--   IFF_OPERATOR_ROLE   → iff_operator (read all, write OPS/MARKETPLACE)
--   IFF_NATION_ROLE     → nation_admin (read all, write own nation rows)
--   IFF_HARVESTER_ROLE  → harvester (read pricing+forecast, write own lots)
--   IFF_BUYER_ROLE      → buyer_tier1/2/3 (read pricing, write bids)
--   IFF_VIEWER_ROLE     → consumer/chef/grocer/viewer/investor (read-only)
--   IFF_PIPELINE_ROLE   → service account for Cloudflare Worker
-- =================================================================

USE ROLE ACCOUNTADMIN;

-- ----------------------------------------------------------------
-- Create roles
-- ----------------------------------------------------------------
CREATE ROLE IF NOT EXISTS IFF_ADMIN_ROLE      COMMENT = 'IFF admin — full access';
CREATE ROLE IF NOT EXISTS IFF_OPERATOR_ROLE   COMMENT = 'IFF operator — read all, write ops + marketplace';
CREATE ROLE IF NOT EXISTS IFF_NATION_ROLE     COMMENT = 'Nation admin — read all, write own nation';
CREATE ROLE IF NOT EXISTS IFF_HARVESTER_ROLE  COMMENT = 'Harvester — read pricing/forecast, write own lots';
CREATE ROLE IF NOT EXISTS IFF_BUYER_ROLE      COMMENT = 'Buyer — read pricing, write bids';
CREATE ROLE IF NOT EXISTS IFF_VIEWER_ROLE     COMMENT = 'Read-only — consumer/chef/grocer/viewer/investor';
CREATE ROLE IF NOT EXISTS IFF_PIPELINE_ROLE   COMMENT = 'Service account — Cloudflare Worker';

GRANT ROLE IFF_OPERATOR_ROLE  TO ROLE IFF_ADMIN_ROLE;
GRANT ROLE IFF_NATION_ROLE    TO ROLE IFF_OPERATOR_ROLE;
GRANT ROLE IFF_HARVESTER_ROLE TO ROLE IFF_NATION_ROLE;
GRANT ROLE IFF_VIEWER_ROLE    TO ROLE IFF_BUYER_ROLE;
GRANT ROLE IFF_VIEWER_ROLE    TO ROLE IFF_HARVESTER_ROLE;

-- ----------------------------------------------------------------
-- Warehouse usage
-- ----------------------------------------------------------------
GRANT USAGE ON WAREHOUSE IFF_WH TO ROLE IFF_ADMIN_ROLE;
GRANT USAGE ON WAREHOUSE IFF_WH TO ROLE IFF_OPERATOR_ROLE;
GRANT USAGE ON WAREHOUSE IFF_WH TO ROLE IFF_NATION_ROLE;
GRANT USAGE ON WAREHOUSE IFF_WH TO ROLE IFF_HARVESTER_ROLE;
GRANT USAGE ON WAREHOUSE IFF_WH TO ROLE IFF_BUYER_ROLE;
GRANT USAGE ON WAREHOUSE IFF_WH TO ROLE IFF_VIEWER_ROLE;
GRANT USAGE ON WAREHOUSE IFF_WH TO ROLE IFF_PIPELINE_ROLE;

-- ----------------------------------------------------------------
-- Database + schema usage
-- ----------------------------------------------------------------
GRANT USAGE ON DATABASE IFF_SEAFOOD TO ROLE IFF_VIEWER_ROLE;
GRANT USAGE ON ALL SCHEMAS IN DATABASE IFF_SEAFOOD TO ROLE IFF_VIEWER_ROLE;
GRANT USAGE ON FUTURE SCHEMAS IN DATABASE IFF_SEAFOOD TO ROLE IFF_VIEWER_ROLE;

-- ----------------------------------------------------------------
-- Read grants
-- ----------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA IFF_SEAFOOD.OPS         TO ROLE IFF_VIEWER_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA IFF_SEAFOOD.ANALYTICS   TO ROLE IFF_VIEWER_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA IFF_SEAFOOD.MARKETPLACE TO ROLE IFF_VIEWER_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA IFF_SEAFOOD.RESEARCH    TO ROLE IFF_VIEWER_ROLE;
GRANT SELECT ON ALL VIEWS  IN SCHEMA IFF_SEAFOOD.OPS         TO ROLE IFF_VIEWER_ROLE;
GRANT SELECT ON ALL VIEWS  IN SCHEMA IFF_SEAFOOD.ANALYTICS   TO ROLE IFF_VIEWER_ROLE;
GRANT SELECT ON FUTURE TABLES IN DATABASE IFF_SEAFOOD TO ROLE IFF_VIEWER_ROLE;
GRANT SELECT ON FUTURE VIEWS  IN DATABASE IFF_SEAFOOD TO ROLE IFF_VIEWER_ROLE;

-- ----------------------------------------------------------------
-- Write grants per role
-- ----------------------------------------------------------------
-- Harvester: write own lots + lot events
GRANT INSERT, UPDATE ON IFF_SEAFOOD.MARKETPLACE.LOTS        TO ROLE IFF_HARVESTER_ROLE;
GRANT INSERT          ON IFF_SEAFOOD.MARKETPLACE.LOT_EVENTS  TO ROLE IFF_HARVESTER_ROLE;

-- Buyer: write bids + settlement reads
GRANT INSERT ON IFF_SEAFOOD.MARKETPLACE.BIDS                 TO ROLE IFF_BUYER_ROLE;

-- Operator: ops + research write
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA IFF_SEAFOOD.OPS         TO ROLE IFF_OPERATOR_ROLE;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA IFF_SEAFOOD.RESEARCH    TO ROLE IFF_OPERATOR_ROLE;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA IFF_SEAFOOD.MARKETPLACE TO ROLE IFF_OPERATOR_ROLE;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA IFF_SEAFOOD.ANALYTICS   TO ROLE IFF_OPERATOR_ROLE;

-- Pipeline service account: same as operator (Worker writes signals_feed, lot_events, bids, scans)
GRANT INSERT, UPDATE        ON ALL TABLES IN SCHEMA IFF_SEAFOOD.OPS         TO ROLE IFF_PIPELINE_ROLE;
GRANT INSERT, UPDATE        ON ALL TABLES IN SCHEMA IFF_SEAFOOD.RESEARCH    TO ROLE IFF_PIPELINE_ROLE;
GRANT INSERT, UPDATE        ON ALL TABLES IN SCHEMA IFF_SEAFOOD.MARKETPLACE TO ROLE IFF_PIPELINE_ROLE;
GRANT INSERT, UPDATE        ON ALL TABLES IN SCHEMA IFF_SEAFOOD.ANALYTICS   TO ROLE IFF_PIPELINE_ROLE;
GRANT INSERT, UPDATE        ON FUTURE TABLES IN DATABASE IFF_SEAFOOD        TO ROLE IFF_PIPELINE_ROLE;
GRANT SELECT                ON FUTURE TABLES IN DATABASE IFF_SEAFOOD        TO ROLE IFF_PIPELINE_ROLE;

-- Admin: everything
GRANT ALL ON DATABASE IFF_SEAFOOD               TO ROLE IFF_ADMIN_ROLE;
GRANT ALL ON ALL SCHEMAS IN DATABASE IFF_SEAFOOD TO ROLE IFF_ADMIN_ROLE;
GRANT ALL ON FUTURE SCHEMAS IN DATABASE IFF_SEAFOOD TO ROLE IFF_ADMIN_ROLE;

-- ----------------------------------------------------------------
-- Service user for Cloudflare Worker
-- ----------------------------------------------------------------
-- (Run manually with secure password / key-pair auth)
-- CREATE USER IF NOT EXISTS IFF_WORKER_SVC
--   PASSWORD = 'CHANGE_ME_USE_SECRETS'
--   DEFAULT_ROLE = IFF_PIPELINE_ROLE
--   DEFAULT_WAREHOUSE = IFF_WH
--   DEFAULT_NAMESPACE = IFF_SEAFOOD.OPS
--   COMMENT = 'Service account for Cloudflare Worker iff-platform';
-- GRANT ROLE IFF_PIPELINE_ROLE TO USER IFF_WORKER_SVC;
