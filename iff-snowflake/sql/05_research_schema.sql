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
