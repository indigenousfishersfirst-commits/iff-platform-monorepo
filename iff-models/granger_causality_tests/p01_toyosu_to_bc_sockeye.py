"""
P01 — Toyosu sockeye JPY/kg Granger-causes BC sockeye landed CAD/kg

Hypothesis: Tokyo wholesale market price leads BC ex-vessel by ~7 days.
Run weekly via .github/workflows/models-publish.yml.
Output to IFF_SEAFOOD.ANALYTICS.GRANGER_RESULTS.
"""

import os
import pandas as pd
import numpy as np
from statsmodels.tsa.stattools import grangercausalitytests, adfuller
from snowflake.snowpark import Session

PATTERN_ID = "P01"
DRIVER     = "toyosu_sockeye_jpy_kg"
TARGET     = "bc_sockeye_landed_cad_kg"
MAX_LAG_DAYS = 21


def get_session():
    cfg = {
        "account":   os.environ["SNOWFLAKE_ACCOUNT"],
        "user":      os.environ["SNOWFLAKE_USER"],
        "password":  os.environ["SNOWFLAKE_PASSWORD"],
        "role":      "IFF_PIPELINE_ROLE",
        "warehouse": "IFF_WH",
        "database":  "IFF_SEAFOOD",
        "schema":    "OPS",
    }
    return Session.builder.configs(cfg).create()


def load_series(session, name, days=730):
    df = session.sql(f"""
        SELECT DATE_TRUNC('day', COMPUTED_AT)::DATE AS DT, AVG(VALUE) AS V
        FROM IFF_SEAFOOD.OPS.SIGNALS_FEED
        WHERE SIGNAL_ID = '{name}'
          AND COMPUTED_AT >= DATEADD(day, -{days}, CURRENT_TIMESTAMP())
        GROUP BY DT ORDER BY DT
    """).to_pandas()
    df.columns = [c.upper() for c in df.columns]
    df = df.set_index("DT")["V"].astype(float)
    return df


def run():
    s = get_session()
    driver = load_series(s, DRIVER)
    target = load_series(s, TARGET)
    df = pd.concat([driver.rename("driver"), target.rename("target")], axis=1).dropna()

    # Stationarity check — first difference if non-stationary
    if adfuller(df["driver"])[1] > 0.05:
        df["driver"] = df["driver"].diff()
    if adfuller(df["target"])[1] > 0.05:
        df["target"] = df["target"].diff()
    df = df.dropna()

    if len(df) < MAX_LAG_DAYS * 3:
        print(f"insufficient data: {len(df)} rows")
        return

    results = grangercausalitytests(df[["target", "driver"]], maxlag=MAX_LAG_DAYS, verbose=False)
    best_lag, best_p, best_f = None, 1.0, 0.0
    for lag, r in results.items():
        f, p = r[0]["ssr_ftest"][0], r[0]["ssr_ftest"][1]
        if p < best_p:
            best_lag, best_p, best_f = lag, p, f

    # Compute R²
    from statsmodels.api import OLS, add_constant
    X = pd.concat([df["driver"].shift(i) for i in range(1, best_lag + 1)], axis=1).dropna()
    y = df["target"].loc[X.index]
    r2 = OLS(y, add_constant(X)).fit().rsquared

    s.sql(f"""
        INSERT INTO IFF_SEAFOOD.ANALYTICS.GRANGER_RESULTS
            (PATTERN_ID, DRIVER_VARIABLE, TARGET_VARIABLE, F_STATISTIC, P_VALUE,
             LAG_OPTIMAL, R2, N_OBSERVATIONS, COMPUTED_AT, NOTEBOOK_RUN_ID)
        VALUES ('{PATTERN_ID}', '{DRIVER}', '{TARGET}', {best_f:.4f}, {best_p:.6f},
                {best_lag}, {r2:.4f}, {len(df)}, CURRENT_TIMESTAMP(),
                '{os.environ.get("GITHUB_RUN_ID", "manual")}')
    """).collect()
    print(f"P01 published: F={best_f:.2f} p={best_p:.4f} lag={best_lag} R²={r2:.3f}")


if __name__ == "__main__":
    run()
