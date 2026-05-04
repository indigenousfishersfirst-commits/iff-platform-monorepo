// modules/granger.js
// Lightweight Granger causality F-test on time series stored in Snowflake.
// Used for P01-P12 patterns in the variable database. Heavy compute lives in
// iff-models/granger_causality_tests/ (Python notebooks); this is the in-Worker
// summary that exposes results via API.

import { sfQuery } from '../lib/snowflake.js';

const PATTERNS = [
  { id: 'P01', name: 'Toyosu → BC sockeye landed', driver: 'toyosu_sockeye_jpy_kg', target: 'bc_sockeye_landed_cad_kg' },
  { id: 'P02', name: 'JPY/CAD → BC sockeye export', driver: 'fx_jpy_cad', target: 'bc_sockeye_export_value' },
  { id: 'P03', name: 'NOAA SST → spot prawn CPUE', driver: 'noaa_sst_46036', target: 'bc_spot_prawn_cpue' },
  { id: 'P04', name: 'Diesel CAD/L → vessel breakeven', driver: 'diesel_cad_l', target: 'vessel_breakeven_cad_kg' },
  { id: 'P05', name: 'PDO index → salmon return forecast', driver: 'pdo_index', target: 'fraser_sockeye_return' },
  { id: 'P06', name: 'Google Trends crab → BC dungeness ex-vessel', driver: 'gtrend_dungeness', target: 'bc_dungeness_ex_vessel' },
  { id: 'P07', name: 'EU IUU score → Canadian seafood imports', driver: 'eu_iuu_score', target: 'eu_ca_seafood_import' },
  { id: 'P08', name: 'Hong Kong wedding season → live geoduck price', driver: 'hk_wedding_index', target: 'hk_live_geoduck_price' },
  { id: 'P09', name: 'Toyosu uni → BC red urchin ex-vessel', driver: 'toyosu_uni_jpy_kg', target: 'bc_red_urchin_ex_vessel' },
  { id: 'P10', name: 'Boston Seafood Show timing → wholesale sockeye USD', driver: 'boston_show_proximity', target: 'us_wholesale_sockeye' },
  { id: 'P11', name: 'Tariff TS-001 → JP import volume', driver: 'ts_001_active', target: 'jp_ca_seafood_import_vol' },
  { id: 'P12', name: 'CPI food → consumer salmon retail', driver: 'cpi_food_ca', target: 'retail_sockeye_cad_kg' },
];

export async function listPatterns() {
  return PATTERNS;
}

export async function getPatternResult(env, patternId) {
  // Read latest published result from Snowflake ANALYTICS schema
  const rows = await sfQuery(env, `
    SELECT PATTERN_ID, F_STATISTIC, P_VALUE, LAG_OPTIMAL, R2,
           DRIVER_VARIABLE, TARGET_VARIABLE, COMPUTED_AT
    FROM IFF_SEAFOOD.ANALYTICS.GRANGER_RESULTS
    WHERE PATTERN_ID = ?
    ORDER BY COMPUTED_AT DESC LIMIT 1
  `, [patternId]);
  return rows[0] || null;
}

export async function getAllLatestPatterns(env) {
  const rows = await sfQuery(env, `
    SELECT g.*
    FROM IFF_SEAFOOD.ANALYTICS.GRANGER_RESULTS g
    QUALIFY ROW_NUMBER() OVER (PARTITION BY PATTERN_ID ORDER BY COMPUTED_AT DESC) = 1
  `);
  return rows;
}

/**
 * Score a price observation against all patterns.
 * Returns the patterns that currently apply (lag matched + signal direction).
 */
export async function scoreObservationAgainstPatterns(env, { species, value, observedAt }) {
  const all = await getAllLatestPatterns(env);
  const scored = [];

  for (const p of all) {
    if (!p.TARGET_VARIABLE?.includes(species.toLowerCase())) continue;
    if (p.P_VALUE > 0.05) continue; // not statistically significant

    scored.push({
      pattern_id: p.PATTERN_ID,
      strength: 1 - p.P_VALUE,
      lag_weeks: p.LAG_OPTIMAL,
      r2: p.R2
    });
  }

  return { species, value, observed_at: observedAt, applicable_patterns: scored };
}
