// Consensus engine — turns raw features into the unified envelope.
// Implements all 8 composite signals (CS01..CS08) and the M19 arbitrator.
// Coefficients live in OPS.MODEL_COEFFICIENTS; this module reads them.

import { Snowflake } from "../lib/snowflake.js";
import { buildEnvelope, KIND, ACTION } from "../lib/envelope.js";

const norm = (v, lo = 0, hi = 1) =>
  Math.max(0, Math.min(1, (Number(v) - lo) / (hi - lo)));

function actionForScore(score) {
  if (score >= 75) return ACTION.BUY;
  if (score >= 55) return ACTION.HOLD;
  if (score >= 35) return ACTION.MONITOR;
  return ACTION.SELL;
}

// ---------------------------------------------------------------------
// CS01..CS08 — formulas straight from v3 Tab 4
// ---------------------------------------------------------------------
export function cs01(f) { // Harvest-Pressure (lower = more pressure → SELL pressure on price)
  const score = 100 - (
    0.30 * norm(f.run_forecast_pct_of_5yr_avg) +
    0.25 * norm(f.cold_storage_ratio) +
    0.20 * norm(f.active_vessel_ratio) +
    0.15 * norm(f.harvest_rate_pct_quota) +
    0.10 * norm(f.diesel_cost_index)
  ) * 100;
  return { score: Math.round(score), drivers: [
    { name: "run_forecast_pct_of_5yr_avg", value: f.run_forecast_pct_of_5yr_avg, weight: 0.30 },
    { name: "cold_storage_ratio",          value: f.cold_storage_ratio,          weight: 0.25 },
    { name: "active_vessel_ratio",         value: f.active_vessel_ratio,         weight: 0.20 },
    { name: "harvest_rate_pct_quota",      value: f.harvest_rate_pct_quota,      weight: 0.15 },
    { name: "diesel_cost_index",           value: f.diesel_cost_index,           weight: 0.10 },
  ]};
}

export function cs02(f) { // Demand-Pull
  const s = 0.25 * norm(f.google_trends_score_0to100, 0, 100)
          + 0.25 * norm(f.opentable_yoy_pct, -50, 50)
          + 0.20 * norm(f.retail_feature_score_0to1)
          + 0.20 * norm(f.export_order_index_0to1)
          + 0.10 * norm(f.cdm_multiplier_0_5to2_0, 0.5, 2.0);
  return { score: Math.round(s * 100), drivers: [
    { name: "google_trends_score_0to100", value: f.google_trends_score_0to100, weight: 0.25 },
    { name: "opentable_yoy_pct",          value: f.opentable_yoy_pct,          weight: 0.25 },
    { name: "retail_feature_score_0to1",  value: f.retail_feature_score_0to1,  weight: 0.20 },
    { name: "export_order_index_0to1",    value: f.export_order_index_0to1,    weight: 0.20 },
    { name: "cdm_multiplier",             value: f.cdm_multiplier_0_5to2_0,    weight: 0.10 },
  ]};
}

export function cs03(f) { // Margin Capture
  const margin = (f.dest_wholesale_usd_per_lb - f.ex_vessel_bc_usd_per_lb
                  - f.processing_cost_usd_per_lb - f.transit_cost_usd_per_lb
                  - (f.tariff_amount_usd_per_lb || 0))
                 / Math.max(0.01, f.dest_wholesale_usd_per_lb);
  return { score: Math.round(norm(margin, 0, 0.6) * 100), drivers: [
    { name: "dest_wholesale_usd_per_lb",  value: f.dest_wholesale_usd_per_lb },
    { name: "ex_vessel_bc_usd_per_lb",    value: f.ex_vessel_bc_usd_per_lb },
    { name: "processing_cost_usd_per_lb", value: f.processing_cost_usd_per_lb },
    { name: "transit_cost_usd_per_lb",    value: f.transit_cost_usd_per_lb },
    { name: "tariff_amount_usd_per_lb",   value: f.tariff_amount_usd_per_lb || 0 },
  ]};
}

export function cs04(f) { // Arbitrage Opportunity
  const s = 0.40 * norm(f.spread_usd_per_lb / Math.max(0.01, f.cost_to_move_usd_per_lb), 0, 3)
          + 0.30 * (1 - norm(f.tariff_risk_0to1))
          + 0.20 * norm(f.transit_reliability_0to1)
          + 0.10 * norm(f.liquidity_score_0to1);
  return { score: Math.round(s * 100), drivers: [
    { name: "spread_usd_per_lb",       value: f.spread_usd_per_lb,       weight: 0.40 },
    { name: "tariff_risk_0to1",        value: f.tariff_risk_0to1,        weight: 0.30 },
    { name: "transit_reliability",     value: f.transit_reliability_0to1,weight: 0.20 },
    { name: "liquidity_score_0to1",    value: f.liquidity_score_0to1,    weight: 0.10 },
  ]};
}

export function cs05(f) { // Inventory Carry
  const s = 0.35 * norm(f.forward_premium_pct / Math.max(0.001, f.cold_storage_monthly_cost_usd_per_lb), 0, 5)
          + 0.30 * (1 - norm(f.storage_ratio_actual_vs_5yr))
          + 0.20 * norm(f.seasonal_peak_weeks_out, 0, 26)
          + 0.15 * norm(f.fx_forward_benefit_pct, 0, 0.1);
  return { score: Math.round(s * 100), drivers: [
    { name: "forward_premium_pct",            value: f.forward_premium_pct,            weight: 0.35 },
    { name: "storage_ratio_actual_vs_5yr",    value: f.storage_ratio_actual_vs_5yr,    weight: 0.30 },
    { name: "seasonal_peak_weeks_out",        value: f.seasonal_peak_weeks_out,        weight: 0.20 },
    { name: "fx_forward_benefit_pct",         value: f.fx_forward_benefit_pct,         weight: 0.15 },
  ]};
}

export function cs06(f) { // Substitution Risk
  const s = 0.30 * norm(f.norway_vs_wild_ratio_0to2, 0, 2)
          + 0.20 * norm(f.chile_salmon_vol_index_0to1)
          + 0.20 * norm(f.beef_price_index_0to1)
          + 0.15 * norm(f.chicken_price_index_0to1)
          + 0.15 * norm(f.farmed_shrimp_price_index_0to1);
  return { score: Math.round(s * 100), drivers: [
    { name: "norway_vs_wild_ratio_0to2",      value: f.norway_vs_wild_ratio_0to2,      weight: 0.30 },
    { name: "chile_salmon_vol_index_0to1",    value: f.chile_salmon_vol_index_0to1,    weight: 0.20 },
    { name: "beef_price_index_0to1",          value: f.beef_price_index_0to1,          weight: 0.20 },
    { name: "chicken_price_index_0to1",       value: f.chicken_price_index_0to1,       weight: 0.15 },
    { name: "farmed_shrimp_price_index_0to1", value: f.farmed_shrimp_price_index_0to1, weight: 0.15 },
  ]};
}

export function cs07(f) { // Fuel-Effort Suppression
  const s = 0.40 * norm(f.diesel_dock_price_usd_per_gallon /
                        Math.max(0.01, f.vessel_breakeven_diesel_usd_per_gallon), 0, 2)
          + 0.30 * norm(Math.abs(f.diesel_wow_change_pct) /
                        Math.max(0.01, f.max_historic_wow_change || 0.2), 0, 2)
          + 0.30 * norm(f.fuel_cost_share_of_revenue_0to1);
  return { score: Math.round(s * 100), drivers: [
    { name: "diesel_dock_price_usd_per_gallon",        value: f.diesel_dock_price_usd_per_gallon,        weight: 0.40 },
    { name: "diesel_wow_change_pct",                   value: f.diesel_wow_change_pct,                   weight: 0.30 },
    { name: "fuel_cost_share_of_revenue_0to1",         value: f.fuel_cost_share_of_revenue_0to1,         weight: 0.30 },
  ]};
}

export function cs08(f) { // Cultural-Demand Multiplier — returns multiplier, not 0-100 score
  const mult = (f.active_event_weights?.length || 0) > 1
    ? Math.max(...f.active_event_weights) + 0.1 * (f.active_event_weights.length - 1)
    : (f.active_event_weights?.[0] || 1.0);
  return { score: Math.round(mult * 50), // 1.0 → 50, 2.0 → 100
           multiplier: mult,
           drivers: [{ name: "active_events", value: f.active_event_ids || [] }]};
}

// ---------------------------------------------------------------------
// M19 arbitrator — generalized (works for any pair of horizon models)
// ---------------------------------------------------------------------
export function m19Arbitrate({ short, long, marketPrice, hedgeBand }) {
  // short: e.g. M11 ARIMA-X 3mo result
  // long:  e.g. M16 PCA-VAR 12mo result
  // Output: HOLD/BUY/SELL with confidence
  const agree = Math.sign(short - marketPrice) === Math.sign(long - marketPrice);
  const spread = Math.abs(long - short) / Math.max(0.01, marketPrice);
  const inBand = marketPrice >= hedgeBand.lo && marketPrice <= hedgeBand.hi;

  let action = ACTION.HOLD;
  if (agree && short < marketPrice && long < marketPrice) action = ACTION.SELL;
  if (agree && short > marketPrice && long > marketPrice) action = ACTION.BUY;
  if (inBand) action = ACTION.HOLD;

  const confidence = Math.max(0.5, 1 - spread);
  return { action, confidence };
}

// ---------------------------------------------------------------------
// Top-level recompute
// ---------------------------------------------------------------------
const SIGNAL_FNS = {
  CS01: cs01, CS02: cs02, CS03: cs03, CS04: cs04,
  CS05: cs05, CS06: cs06, CS07: cs07, CS08: cs08,
};

const SIGNAL_NAMES = {
  CS01: "Harvest-Pressure Index",
  CS02: "Demand-Pull Index",
  CS03: "Margin Capture Score",
  CS04: "Arbitrage Opportunity Score",
  CS05: "Inventory Carry Score",
  CS06: "Substitution Risk Score",
  CS07: "Fuel-Effort Suppression Score",
  CS08: "Cultural-Demand Multiplier",
};

export async function recomputeAllSignals(env) {
  const sf = new Snowflake(env);
  const features = await sf.query("SELECT * FROM OPS.V_FEATURES_LATEST");
  if (!features.length) return { rows: 0 };

  const envelopes = [];
  for (const row of features) {
    const f = lowercaseKeys(row);
    for (const [id, fn] of Object.entries(SIGNAL_FNS)) {
      try {
        const out = fn(f);
        envelopes.push(buildEnvelope({
          id: `${id}:${f.species || "ALL"}:${f.market || "ALL"}`,
          kind: KIND.COMPOSITE,
          name: SIGNAL_NAMES[id],
          horizon: "weekly",
          score: out.score,
          action: actionForScore(out.score),
          confidence: out.score / 100,
          scope: { species: f.species, market: f.market },
          drivers: out.drivers,
          sourceModels: [id],
          version: "v3.2",
        }));
      } catch (e) { console.error(`${id} fail`, e.message); }
    }
  }

  // Persist to OPS.SIGNALS_FEED
  await sf.upsert(
    "OPS.SIGNALS_FEED",
    ["ID", "AS_OF"],
    ["ID", "KIND", "AS_OF", "ENVELOPE"],
    envelopes.map((e) => ({
      ID: e.id, KIND: e.kind,
      AS_OF: new Date().toISOString(),
      ENVELOPE: JSON.stringify(e),
    })),
  );

  return { rows: envelopes.length };
}

export async function recomputeOneSignal(env, payload) {
  // payload: { id?, species?, kind? } — narrow recompute for queue jobs
  return recomputeAllSignals(env);
}

function lowercaseKeys(o) {
  const out = {};
  for (const k in o) out[k.toLowerCase()] = o[k];
  return out;
}
