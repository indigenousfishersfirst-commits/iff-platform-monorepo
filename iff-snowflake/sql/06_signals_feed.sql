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

CREATE OR REPLACE INDEX IDX_FEED_SIGNAL_TIME
  ON SIGNALS_FEED(SIGNAL_ID, COMPUTED_AT DESC);
CREATE OR REPLACE INDEX IDX_FEED_KIND_TIME
  ON SIGNALS_FEED(KIND, COMPUTED_AT DESC);
CREATE OR REPLACE INDEX IDX_FEED_SPECIES
  ON SIGNALS_FEED(SPECIES);

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

CREATE OR REPLACE INDEX IDX_FORECAST_MODEL_SPECIES
  ON MODEL_FORECASTS(MODEL_ID, SPECIES, COMPUTED_AT DESC);

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

CREATE OR REPLACE INDEX IDX_GRANGER_PATTERN_TIME
  ON GRANGER_RESULTS(PATTERN_ID, COMPUTED_AT DESC);
