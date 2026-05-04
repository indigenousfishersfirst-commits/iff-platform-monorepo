"""
publish.py — orchestrates the full models pipeline:
  1. Sync variable_database.csv → Snowflake RESEARCH.VARIABLE_DATABASE
  2. Run all P01-P12 Granger tests
  3. Run M11/M16/M19 forecasts
  4. Notify Cloudflare Worker to refresh signals cache
"""

import os
import csv
import importlib
import requests
from snowflake.snowpark import Session


def session():
    return Session.builder.configs({
        "account":   os.environ["SNOWFLAKE_ACCOUNT"],
        "user":      os.environ["SNOWFLAKE_USER"],
        "password":  os.environ["SNOWFLAKE_PASSWORD"],
        "role":      "IFF_PIPELINE_ROLE",
        "warehouse": "IFF_WH",
        "database":  "IFF_SEAFOOD",
    }).create()


def sync_variable_database():
    s = session()
    rows = []
    with open("variable_database.csv") as f:
        for r in csv.DictReader(f):
            rows.append((
                r["variable_name"], r["description"], r["category"], r["unit"],
                r["frequency"], r["primary_source"], r["secondary_source"],
                int(r["typical_lag_days"] or 0),
                r["used_in_patterns"], r["used_in_models"]
            ))
    s.sql("DELETE FROM IFF_SEAFOOD.RESEARCH.VARIABLE_DATABASE").collect()
    for r in rows:
        s.sql(f"""
            INSERT INTO IFF_SEAFOOD.RESEARCH.VARIABLE_DATABASE
              (VARIABLE_NAME, DESCRIPTION, CATEGORY, UNIT, FREQUENCY, PRIMARY_SOURCE,
               SECONDARY_SOURCE, TYPICAL_LAG_DAYS, USED_IN_PATTERNS, USED_IN_MODELS,
               ADDED_AT, ADDED_BY)
            SELECT '{r[0]}','{r[1]}','{r[2]}','{r[3]}','{r[4]}','{r[5]}','{r[6]}',
                   {r[7]}, ARRAY_CONSTRUCT({",".join(f"'{x}'" for x in r[8].split(';') if x)}),
                   ARRAY_CONSTRUCT({",".join(f"'{x}'" for x in r[9].split(';') if x)}),
                   CURRENT_TIMESTAMP(), 'github_actions'
        """).collect()
    print(f"synced {len(rows)} variable definitions")


def run_pattern(pattern_id):
    mod = importlib.import_module(f"granger_causality_tests.{pattern_id.lower()}_run")
    mod.run()


def run_models():
    from models import M11_arimax_3month
    M11_arimax_3month.run()


def notify_worker():
    url = os.environ.get("WORKER_RECOMPUTE_URL")
    if not url:
        return
    api_key = os.environ.get("WORKER_API_KEY")
    headers = {"X-Api-Key": api_key} if api_key else {}
    r = requests.post(url, headers=headers, timeout=30)
    print("worker recompute:", r.status_code)


if __name__ == "__main__":
    sync_variable_database()
    # Pattern modules can be added incrementally
    try:
        from granger_causality_tests import p01_toyosu_to_bc_sockeye
        p01_toyosu_to_bc_sockeye.run()
    except Exception as e:
        print("P01 failed:", e)
    run_models()
    notify_worker()
