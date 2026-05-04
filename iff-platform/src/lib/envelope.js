// Unified signal envelope — every CS/M/TS/indicator/pattern serializes here.
// Keep this in lockstep with iff-snowflake/sql/06_signals_feed.sql

export const KIND = {
  COMPOSITE: "composite", // CS01..CS08
  MODEL:     "model",     // M01..M20 (incl. M11/M16/M19)
  TARIFF:    "tariff",    // TS-001..TS-012
  INDICATOR: "indicator", // 28 hidden signals
  PATTERN:   "pattern",   // 12 Granger patterns
};

export const ACTION = {
  BUY: "BUY", SELL: "SELL", HOLD: "HOLD", MONITOR: "MONITOR",
};

export function buildEnvelope({
  id, kind, name, asOf = new Date(), horizon, score, scoreScale = "0-100",
  action = null, confidence = null, regime = null, scope = {}, drivers = [],
  narrative = "", sourceModels = [], evidenceUrls = [], version = "v3.2",
}) {
  if (!Object.values(KIND).includes(kind))
    throw new Error(`invalid kind: ${kind}`);
  if (action && !Object.values(ACTION).includes(action))
    throw new Error(`invalid action: ${action}`);

  return {
    id,
    kind,
    name,
    as_of: asOf instanceof Date ? asOf.toISOString() : asOf,
    horizon,
    score,
    score_scale: scoreScale,
    action,
    confidence,
    regime,
    scope,
    drivers: drivers.map((d) => ({
      name: d.name,
      value: d.value ?? null,
      weight: d.weight ?? null,
      contribution: d.contribution ?? null,
    })),
    narrative,
    source_models: sourceModels,
    evidence_urls: evidenceUrls,
    version,
  };
}

// Validator used at the API boundary so frontends never see malformed data
export function validateEnvelope(env) {
  const required = ["id", "kind", "name", "as_of", "score"];
  for (const k of required) {
    if (env[k] === undefined || env[k] === null)
      throw new Error(`envelope missing ${k}`);
  }
  return env;
}
