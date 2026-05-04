"""
M11 — ARIMA-X 3-month forecast (sockeye, dungeness, halibut, prawn)

Exogenous regressors:
  fx_jpy_cad, toyosu_sockeye_jpy_kg, diesel_cad_l, gtrend_*, oni_index

Output: IFF_SEAFOOD.ANALYTICS.MODEL_FORECASTS  (MODEL_ID = 'M11')
Cron:   weekly (.github/workflows/models-publish.yml)
"""

import os
import pandas as pd
from statsmodels.tsa.arima.model import ARIMA
from snowflake.snowpark import Session

MODEL_ID = "M11"
HORIZON = 90  # days = 3 months

SPECIES = {
    "sockeye":   ("bc_sockeye_landed_cad_kg",   ["fx_jpy_cad", "toyosu_sockeye_jpy_kg", "diesel_cad_l"]),
    "dungeness": ("bc_dungeness_ex_vessel",      ["gtrend_dungeness", "diesel_cad_l"]),
    "halibut":   ("us_wholesale_sockeye",        ["fx_usd_cad", "diesel_cad_l"]),  # proxy target
    "prawn":     ("bc_spot_prawn_cpue",          ["noaa_sst_46036"]),
}


def get_session():
    return Session.builder.configs({
        "account":   os.environ["SNOWFLAKE_ACCOUNT"],
        "user":      os.environ["SNOWFLAKE_USER"],
        "password":  os.environ["SNOWFLAKE_PASSWORD"],
        "role":      "IFF_PIPELINE_ROLE",
        "warehouse": "IFF_WH",
        "database":  "IFF_SEAFOOD",
    }).create()


def load(session, name, days=730):
    return session.sql(f"""
        SELECT DATE_TRUNC('day', COMPUTED_AT)::DATE AS DT, AVG(VALUE) AS V
        FROM IFF_SEAFOOD.OPS.SIGNALS_FEED
        WHERE SIGNAL_ID = '{name}' AND COMPUTED_AT >= DATEADD(day, -{days}, CURRENT_TIMESTAMP())
        GROUP BY DT ORDER BY DT
    """).to_pandas().set_index("DT")["V"].astype(float)


def fit_and_forecast(species, target_id, exog_ids, session):
    target = load(session, target_id)
    exog = pd.concat([load(session, x).rename(x) for x in exog_ids], axis=1)
    df = pd.concat([target.rename("y"), exog], axis=1).dropna()
    if len(df) < 60:
        print(f"{species}: insufficient data")
        return

    model = ARIMA(df["y"], exog=df[exog_ids], order=(2, 1, 2))
    fit = model.fit()

    last_exog = df[exog_ids].iloc[-1].values
    forecast_exog = pd.DataFrame([last_exog] * HORIZON, columns=exog_ids)
    fcast = fit.get_forecast(steps=HORIZON, exog=forecast_exog)
    mean = fcast.predicted_mean.iloc[-1]
    ci_low, ci_high = fcast.conf_int(alpha=0.20).iloc[-1]

    session.sql(f"""
        INSERT INTO IFF_SEAFOOD.ANALYTICS.MODEL_FORECASTS
            (MODEL_ID, SPECIES, HORIZON_MONTHS, FORECAST_VALUE,
             CONFIDENCE_LOW, CONFIDENCE_HIGH, ASSUMPTIONS, COMPUTED_AT, COMPUTED_BY)
        SELECT '{MODEL_ID}', '{species}', 3, {mean:.4f},
               {ci_low:.4f}, {ci_high:.4f},
               PARSE_JSON('{{"exog":["{",".join(exog_ids)}"], "order":"(2,1,2)"}}'),
               CURRENT_TIMESTAMP(), 'github_actions:models-publish'
    """).collect()
    print(f"{species}: ${mean:.2f}/kg in 3mo · CI [{ci_low:.2f}, {ci_high:.2f}]")


def run():
    s = get_session()
    for species, (tgt, exog) in SPECIES.items():
        try:
            fit_and_forecast(species, tgt, exog, s)
        except Exception as e:
            print(f"{species} failed: {e}")


if __name__ == "__main__":
    run()
