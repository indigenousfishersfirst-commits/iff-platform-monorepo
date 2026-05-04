-- ============================================================
-- IFF Unified Platform — Snowflake bootstrap
-- Run as ACCOUNTADMIN in a Snowsight worksheet.
-- Generated 2026-05-04T23:58:27Z
-- ============================================================

-- ----------------------------------------
-- 00_init.sql
-- ----------------------------------------
-- =================================================================
-- 00_init.sql — bootstrap database, warehouse, and core schemas
-- Run as ACCOUNTADMIN once per environment.
-- =================================================================

USE ROLE ACCOUNTADMIN;

CREATE DATABASE IF NOT EXISTS IFF_SEAFOOD COMMENT = 'IFF unified seafood platform';
CREATE WAREHOUSE IF NOT EXISTS IFF_WH
  WITH WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'IFF compute — auto-resume';

USE DATABASE IFF_SEAFOOD;

CREATE SCHEMA IF NOT EXISTS RAW         COMMENT = 'Raw landed data from external feeds';
CREATE SCHEMA IF NOT EXISTS OPS         COMMENT = 'Signals feed + tariff scenarios + ops state';
CREATE SCHEMA IF NOT EXISTS ANALYTICS   COMMENT = 'Model forecasts + Granger results';
CREATE SCHEMA IF NOT EXISTS MARKETPLACE COMMENT = 'Lots, bids, auctions, lot_events, settlements';
CREATE SCHEMA IF NOT EXISTS RESEARCH    COMMENT = 'Perplexity scans, variables, regulatory, competitors';
CREATE SCHEMA IF NOT EXISTS ENV         COMMENT = 'Environmental + climate observations';

-- ----------------------------------------
-- 01_marketplace.sql
-- ----------------------------------------
-- =================================================================
-- 01_marketplace.sql — lots, bids, lot_events, settlements (master)
-- =================================================================

USE WAREHOUSE IFF_WH;
USE DATABASE IFF_SEAFOOD;
USE SCHEMA MARKETPLACE;

CREATE TABLE IF NOT EXISTS LOTS (
  LOT_ID          STRING        PRIMARY KEY,
  HARVESTER_ID    STRING,
  NATION          STRING,
  VESSEL_NAME     STRING,
  SPECIES         STRING        NOT NULL,
  GEAR            STRING,
  AREA            STRING,
  HARVESTED_AT    TIMESTAMP_NTZ,
  WEIGHT_KG       FLOAT,
  GRADE           STRING,
  STATUS          STRING        DEFAULT 'listed', -- listed|in_auction|sold|shipped|settled|cancelled
  LISTING_PRICE   FLOAT,
  DESTINATION     STRING,
  ENVELOPE        VARIANT,
  CREATED_AT      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  UPDATED_AT      TIMESTAMP_NTZ
);

CREATE TABLE IF NOT EXISTS LOT_EVENTS (
  EVENT_ID      STRING        PRIMARY KEY,
  LOT_ID        STRING        NOT NULL,
  EVENT_TYPE    STRING        NOT NULL,    -- HARVEST|LANDED|PROCESSED|PACKED|SHIPPED|RECEIVED|SOLD
  ACTOR_ID      STRING,
  ACTOR_ROLE    STRING,
  LOCATION      STRING,
  PAYLOAD       VARIANT,
  PREV_HASH     STRING        NOT NULL,
  EVENT_HASH    STRING        NOT NULL,
  OCCURRED_AT   TIMESTAMP_NTZ NOT NULL
);

-- [SF-incompat] CREATE OR REPLACE INDEX IDX_LOT_EVENTS_LOT ON LOT_EVENTS(LOT_ID, OCCURRED_AT);

CREATE TABLE IF NOT EXISTS AUCTIONS (
  AUCTION_ID        STRING        PRIMARY KEY,
  LOT_ID            STRING        NOT NULL,
  TYPE              STRING        NOT NULL,
  STARTING_PRICE    FLOAT,
  RESERVE_PRICE     FLOAT,
  STARTS_AT         TIMESTAMP_NTZ NOT NULL,
  ENDS_AT           TIMESTAMP_NTZ NOT NULL,
  SOFT_CLOSE_SECS   INT           DEFAULT 60,
  STATUS            STRING        DEFAULT 'scheduled',
  WINNING_BID_ID    STRING,
  WINNING_BUYER_ID  STRING,
  WINNING_PRICE     FLOAT,
  CREATED_BY        STRING,
  CREATED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS BIDS (
  BID_ID         STRING        PRIMARY KEY,
  AUCTION_ID     STRING        NOT NULL,
  BUYER_ID       STRING        NOT NULL,
  BUYER_TIER     STRING,
  PRICE          FLOAT         NOT NULL,
  QUANTITY_KG    FLOAT,
  PLACED_AT      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  SOURCE         STRING        DEFAULT 'web',
  REJECTED       BOOLEAN       DEFAULT FALSE,
  REJECTION_REASON STRING
);

CREATE TABLE IF NOT EXISTS SETTLEMENTS (
  SETTLEMENT_ID  STRING        PRIMARY KEY,
  AUCTION_ID     STRING        NOT NULL,
  LOT_ID         STRING        NOT NULL,
  GROSS          FLOAT,
  PLATFORM_FEE   FLOAT,
  NATION_SHARE   FLOAT,
  HARVESTER_NET  FLOAT,
  CURRENCY       STRING        DEFAULT 'CAD',
  STATUS         STRING        DEFAULT 'pending',
  PAID_AT        TIMESTAMP_NTZ,
  STRIPE_PI_ID   STRING,
  CREATED_AT     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ----------------------------------------
-- 05_research_schema.sql
-- ----------------------------------------
-- =================================================================
-- 05_research_schema.sql
-- Perplexity research bridge: scans, extracted variables, competitors,
-- regulatory watches, market intel. Feeds OPS.SIGNALS_FEED.
-- =================================================================

USE WAREHOUSE IFF_WH;
USE DATABASE IFF_SEAFOOD;
CREATE SCHEMA IF NOT EXISTS RESEARCH;
USE SCHEMA RESEARCH;

-- ----------------------------------------------------------------
-- SCANS — every Perplexity research call
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS SCANS (
  SCAN_ID         STRING        PRIMARY KEY,
  TOPIC           STRING        NOT NULL,
  RESULT          VARIANT,                     -- {text, citations[], model, ...}
  PROMPT          STRING,
  MODEL           STRING        DEFAULT 'sonar-pro',
  STATUS          STRING        DEFAULT 'completed',
  RAN_AT          TIMESTAMP_NTZ NOT NULL,
  TRIGGERED_BY    STRING,                       -- user id or 'cron:research-watch'
  TAGS            ARRAY                         -- ['regulatory','competitor','market']
);

-- ----------------------------------------------------------------
-- VARIABLES — extracted quantitative facts from scans
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS VARIABLES (
  VARIABLE_ID      STRING        DEFAULT UUID_STRING() PRIMARY KEY,
  VARIABLE_NAME    STRING        NOT NULL,      -- e.g. 'toyosu_sockeye_jpy_kg'
  CATEGORY         STRING,                      -- price, supply, demand, regulatory, fx
  VALUE            FLOAT,
  UNIT             STRING,
  SPECIES          STRING,
  REGION           STRING,
  SOURCE_SCAN_ID   STRING,
  CONFIDENCE       FLOAT         DEFAULT 0.5,
  EXTRACTED_AT     TIMESTAMP_NTZ NOT NULL,
  PROMOTED_TO_FEED BOOLEAN       DEFAULT FALSE,
  PROMOTED_AT      TIMESTAMP_NTZ
);

-- [SF-incompat] CREATE INDEX IF NOT EXISTS IDX_VARS_NAME ON VARIABLES(VARIABLE_NAME);

-- ----------------------------------------------------------------
-- COMPETITORS — competitive intelligence registry
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS COMPETITORS (
  COMPETITOR_ID    STRING        DEFAULT UUID_STRING() PRIMARY KEY,
  NAME             STRING        NOT NULL,
  HQ_COUNTRY       STRING,
  PRIMARY_SPECIES  ARRAY,
  PRIMARY_MARKETS  ARRAY,
  ANNUAL_VOLUME_T  FLOAT,
  REVENUE_USD      FLOAT,
  NOTES            STRING,
  LAST_UPDATED_AT  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ----------------------------------------------------------------
-- REGULATORY — DFO/CFIA/EU/JP/US rule changes that affect harvest
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS REGULATORY (
  REG_ID            STRING        DEFAULT UUID_STRING() PRIMARY KEY,
  JURISDICTION      STRING        NOT NULL,    -- DFO|CFIA|EU|JP|US|HK|KR|SG|VN
  TITLE             STRING        NOT NULL,
  SUMMARY           STRING,
  SPECIES_AFFECTED  ARRAY,
  EFFECTIVE_FROM    DATE,
  EFFECTIVE_UNTIL   DATE,
  URL               STRING,
  SOURCE_SCAN_ID    STRING,
  SEVERITY          STRING        DEFAULT 'info',  -- info|warn|critical
  CREATED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ----------------------------------------------------------------
-- MARKET_NOTES — any qualitative observation worth retaining
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS MARKET_NOTES (
  NOTE_ID         STRING        DEFAULT UUID_STRING() PRIMARY KEY,
  CATEGORY        STRING,                       -- demand|inventory|sentiment|tariff
  MARKET          STRING,
  SPECIES         STRING,
  NOTE            STRING,
  SOURCE_SCAN_ID  STRING,
  CREATED_AT      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ----------------------------------------------------------------
-- VARIABLE_DATABASE — canonical registry for iff-models repo (mirrors variable_database.csv)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS VARIABLE_DATABASE (
  VARIABLE_NAME   STRING        PRIMARY KEY,
  DESCRIPTION     STRING,
  CATEGORY        STRING,                       -- driver|target|control
  UNIT            STRING,
  FREQUENCY       STRING,                       -- hourly|daily|weekly|monthly
  PRIMARY_SOURCE  STRING,
  SECONDARY_SOURCE STRING,
  TYPICAL_LAG_DAYS INT,
  USED_IN_PATTERNS ARRAY,                       -- ['P01','P09']
  USED_IN_MODELS   ARRAY,                       -- ['M11','M16','M19']
  ADDED_AT         TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  ADDED_BY         STRING
);

-- ----------------------------------------------------------------
-- Convenience view for active regulatory items
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW V_ACTIVE_REGULATIONS AS
SELECT *
FROM REGULATORY
WHERE EFFECTIVE_FROM <= CURRENT_DATE()
  AND (EFFECTIVE_UNTIL IS NULL OR EFFECTIVE_UNTIL >= CURRENT_DATE())
ORDER BY EFFECTIVE_FROM DESC;

-- ----------------------------------------
-- 06_signals_feed.sql
-- ----------------------------------------
-- =================================================================
-- 06_signals_feed.sql
-- The unified signal envelope feed. All CS01-CS08 composite signals,
-- M01-M20 model outputs, TS-001-TS-012 tariff scenarios, P01-P12
-- Granger patterns, and 28 hidden indicators flow into this single
-- table. Cloudflare Worker /v1/signals reads V_SIGNALS_LATEST.
-- =================================================================

USE WAREHOUSE IFF_WH;
USE DATABASE IFF_SEAFOOD;
CREATE SCHEMA IF NOT EXISTS OPS;
USE SCHEMA OPS;

-- ----------------------------------------------------------------
-- SIGNALS_FEED — append-only event stream
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS SIGNALS_FEED (
  EVENT_ID       STRING        DEFAULT UUID_STRING() PRIMARY KEY,
  SIGNAL_ID      STRING        NOT NULL,           -- CS01..CS08, M01..M20, TS-001..TS-012, P01..P12, IND-XX
  KIND           STRING        NOT NULL,           -- composite|model|tariff|pattern|indicator
  SPECIES        STRING,
  VALUE          FLOAT,
  UNIT           STRING,
  CONFIDENCE     FLOAT,
  DIRECTION      STRING,                            -- up|down|flat|null
  ENVELOPE       VARIANT        NOT NULL,           -- full JSON envelope
  COMPUTED_AT    TIMESTAMP_NTZ  NOT NULL,
  INSERTED_AT    TIMESTAMP_NTZ  DEFAULT CURRENT_TIMESTAMP()
);

-- [SF-incompat] CREATE OR REPLACE INDEX IDX_FEED_SIGNAL_TIME
-- [SF-incompat]   ON SIGNALS_FEED(SIGNAL_ID, COMPUTED_AT DESC);
-- [SF-incompat] CREATE OR REPLACE INDEX IDX_FEED_KIND_TIME
-- [SF-incompat]   ON SIGNALS_FEED(KIND, COMPUTED_AT DESC);
-- [SF-incompat] CREATE OR REPLACE INDEX IDX_FEED_SPECIES
-- [SF-incompat]   ON SIGNALS_FEED(SPECIES);

-- ----------------------------------------------------------------
-- V_SIGNALS_LATEST — most recent value per SIGNAL_ID
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW V_SIGNALS_LATEST AS
SELECT *
FROM SIGNALS_FEED
QUALIFY ROW_NUMBER() OVER (PARTITION BY SIGNAL_ID ORDER BY COMPUTED_AT DESC) = 1;

-- ----------------------------------------------------------------
-- V_FEATURES_LATEST — wide feature matrix for model scoring
-- One row per species/timestamp; columns = pivoted SIGNAL_IDs
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW V_FEATURES_LATEST AS
WITH base AS (
  SELECT SPECIES,
         DATE_TRUNC('hour', COMPUTED_AT) AS BUCKET_AT,
         SIGNAL_ID,
         VALUE
  FROM SIGNALS_FEED
  WHERE COMPUTED_AT >= DATEADD(day, -30, CURRENT_TIMESTAMP())
)
SELECT SPECIES,
       BUCKET_AT,
       MAX(IFF(SIGNAL_ID='CS01', VALUE, NULL)) AS CS01,
       MAX(IFF(SIGNAL_ID='CS02', VALUE, NULL)) AS CS02,
       MAX(IFF(SIGNAL_ID='CS03', VALUE, NULL)) AS CS03,
       MAX(IFF(SIGNAL_ID='CS04', VALUE, NULL)) AS CS04,
       MAX(IFF(SIGNAL_ID='CS05', VALUE, NULL)) AS CS05,
       MAX(IFF(SIGNAL_ID='CS06', VALUE, NULL)) AS CS06,
       MAX(IFF(SIGNAL_ID='CS07', VALUE, NULL)) AS CS07,
       MAX(IFF(SIGNAL_ID='CS08', VALUE, NULL)) AS CS08,
       MAX(IFF(SIGNAL_ID='M11',  VALUE, NULL)) AS M11_FORECAST_3M,
       MAX(IFF(SIGNAL_ID='M16',  VALUE, NULL)) AS M16_FORECAST_12M,
       MAX(IFF(SIGNAL_ID='M19',  VALUE, NULL)) AS M19_ARBITRATED
FROM base
GROUP BY SPECIES, BUCKET_AT;

-- ----------------------------------------------------------------
-- ACTIVE_TARIFF_SCENARIOS — currently in-effect TS-001..TS-012
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ACTIVE_TARIFF_SCENARIOS (
  ROW_ID            STRING        DEFAULT UUID_STRING() PRIMARY KEY,
  SCENARIO_ID       STRING        NOT NULL,    -- TS-001..TS-012
  ACTIVATED_AT      TIMESTAMP_NTZ NOT NULL,
  ACTIVATED_BY      STRING,
  DEACTIVATED_AT    TIMESTAMP_NTZ,
  DEACTIVATED_BY    STRING,
  NOTES             STRING
);

-- ----------------------------------------------------------------
-- MODEL_FORECASTS — output table for M11/M16/M19 etc.
-- ----------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS ANALYTICS;
USE SCHEMA ANALYTICS;

CREATE TABLE IF NOT EXISTS MODEL_FORECASTS (
  FORECAST_ID         STRING        DEFAULT UUID_STRING() PRIMARY KEY,
  MODEL_ID            STRING        NOT NULL,    -- M11|M16|M19|...
  MODEL_VERSION       STRING        DEFAULT 'v1.0',
  SPECIES             STRING        NOT NULL,
  HORIZON_MONTHS      INT,
  FORECAST_VALUE      FLOAT,
  CONFIDENCE_LOW      FLOAT,
  CONFIDENCE_HIGH     FLOAT,
  ASSUMPTIONS         VARIANT,
  PRINCIPAL_COMPONENTS VARIANT,
  R2                  FLOAT,
  COMPUTED_AT         TIMESTAMP_NTZ NOT NULL,
  COMPUTED_BY         STRING                     -- 'snowpark:notebook M11.ipynb'
);

-- [SF-incompat] CREATE OR REPLACE INDEX IDX_FORECAST_MODEL_SPECIES
-- [SF-incompat]   ON MODEL_FORECASTS(MODEL_ID, SPECIES, COMPUTED_AT DESC);

-- ----------------------------------------------------------------
-- GRANGER_RESULTS — output of P01..P12 pattern tests
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS GRANGER_RESULTS (
  RESULT_ID         STRING        DEFAULT UUID_STRING() PRIMARY KEY,
  PATTERN_ID        STRING        NOT NULL,    -- P01..P12
  DRIVER_VARIABLE   STRING,
  TARGET_VARIABLE   STRING,
  F_STATISTIC       FLOAT,
  P_VALUE           FLOAT,
  LAG_OPTIMAL       INT,
  R2                FLOAT,
  N_OBSERVATIONS    INT,
  COMPUTED_AT       TIMESTAMP_NTZ NOT NULL,
  NOTEBOOK_RUN_ID   STRING
);

-- [SF-incompat] CREATE OR REPLACE INDEX IDX_GRANGER_PATTERN_TIME
-- [SF-incompat]   ON GRANGER_RESULTS(PATTERN_ID, COMPUTED_AT DESC);

-- ----------------------------------------
-- 07_grants_and_roles.sql
-- ----------------------------------------
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

