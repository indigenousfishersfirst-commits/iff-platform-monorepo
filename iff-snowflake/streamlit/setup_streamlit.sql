-- ============================================================
-- Streamlit-in-Snowflake setup
-- Creates the Streamlit object + uploads app.py to a stage.
-- Run AFTER apply_all.sql.
-- ============================================================
USE ROLE ACCOUNTADMIN;
USE DATABASE IFF_SEAFOOD;
USE WAREHOUSE IFF_WH;

CREATE SCHEMA IF NOT EXISTS APPS;
USE SCHEMA APPS;

-- 1. Stage to host the app code
CREATE STAGE IF NOT EXISTS IFF_STREAMLIT_STAGE
  COMMENT = 'Holds Streamlit app.py for IFF operator dashboard';

-- 2. After uploading app.py to @IFF_STREAMLIT_STAGE/iff_dashboard/app.py
--    via Snowsight UI: Data > Add Data > Add Files to Stage
--    Then run:

CREATE OR REPLACE STREAMLIT IFF_OPERATOR_DASHBOARD
  ROOT_LOCATION = '@IFF_SEAFOOD.APPS.IFF_STREAMLIT_STAGE/iff_dashboard'
  MAIN_FILE = 'app.py'
  QUERY_WAREHOUSE = IFF_WH
  TITLE = 'IFF Unified Operator Dashboard'
  COMMENT = 'Cross-links to harvester/auction/chef/market/shop.cantekhi.com Pages portals; reads OPS.V_SIGNALS_LATEST + ANALYTICS.MODEL_FORECASTS';

GRANT USAGE ON STREAMLIT IFF_OPERATOR_DASHBOARD TO ROLE PUBLIC;
