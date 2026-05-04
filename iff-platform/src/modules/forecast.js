// modules/forecast.js
// Calls Snowflake stored procedures or external Python service (iff-models)
// to produce M11 (ARIMA-X 3-month) and M16 (PCA-VAR 12-month) forecasts.
// M19 (arbitration) is in consensus-engine.js.

import { sfQuery } from '../lib/snowflake.js';

export async function getForecastM11(env, species, horizonMonths = 3) {
  const rows = await sfQuery(env, `
    SELECT MODEL_ID, SPECIES, HORIZON_MONTHS, FORECAST_VALUE, CONFIDENCE_LOW, CONFIDENCE_HIGH,
           ASSUMPTIONS, COMPUTED_AT
    FROM IFF_SEAFOOD.ANALYTICS.MODEL_FORECASTS
    WHERE MODEL_ID = 'M11' AND SPECIES = ? AND HORIZON_MONTHS = ?
    ORDER BY COMPUTED_AT DESC LIMIT 1
  `, [species, horizonMonths]);
  return rows[0] || null;
}

export async function getForecastM16(env, species, horizonMonths = 12) {
  const rows = await sfQuery(env, `
    SELECT MODEL_ID, SPECIES, HORIZON_MONTHS, FORECAST_VALUE, CONFIDENCE_LOW, CONFIDENCE_HIGH,
           PRINCIPAL_COMPONENTS, COMPUTED_AT
    FROM IFF_SEAFOOD.ANALYTICS.MODEL_FORECASTS
    WHERE MODEL_ID = 'M16' AND SPECIES = ? AND HORIZON_MONTHS = ?
    ORDER BY COMPUTED_AT DESC LIMIT 1
  `, [species, horizonMonths]);
  return rows[0] || null;
}

export async function getEnsembleForecast(env, species) {
  const [m11, m16] = await Promise.all([
    getForecastM11(env, species, 3),
    getForecastM16(env, species, 12)
  ]);
  return { species, m11, m16, computed_at: new Date().toISOString() };
}
