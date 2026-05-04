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
