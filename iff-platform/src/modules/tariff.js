// modules/tariff.js
// TS-001 .. TS-012 tariff scenarios. Each is a parameterized rule that adjusts
// landed cost / margin in destination markets when active.

import { sfQuery, sfExec } from '../lib/snowflake.js';

const SCENARIOS = [
  { id: 'TS-001', name: 'JP import duty +5% on chilled salmon', market: 'JP', species: 'sockeye', delta: 0.05 },
  { id: 'TS-002', name: 'JP import duty +10% all salmonids', market: 'JP', species: 'salmon', delta: 0.10 },
  { id: 'TS-003', name: 'EU CBAM extension to seafood', market: 'EU', species: 'all', delta: 0.03 },
  { id: 'TS-004', name: 'CN +15% retaliatory on CA seafood', market: 'CN', species: 'all', delta: 0.15 },
  { id: 'TS-005', name: 'US Section 232 +25% on processed', market: 'US', species: 'all', form: 'processed', delta: 0.25 },
  { id: 'TS-006', name: 'KR FTA reduction sockeye 0%', market: 'KR', species: 'sockeye', delta: -0.07 },
  { id: 'TS-007', name: 'HK no change baseline', market: 'HK', species: 'all', delta: 0.0 },
  { id: 'TS-008', name: 'SG GST harmonization +1%', market: 'SG', species: 'all', delta: 0.01 },
  { id: 'TS-009', name: 'VN reduction live products -3%', market: 'VN', species: 'live', delta: -0.03 },
  { id: 'TS-010', name: 'JP +20% spike emergency duties', market: 'JP', species: 'all', delta: 0.20 },
  { id: 'TS-011', name: 'US-CA CUSMA dispute fish ban 90 days', market: 'US', species: 'all', delta: 1.0 },
  { id: 'TS-012', name: 'EU IUU yellow card +verification 0%', market: 'EU', species: 'all', delta: 0.0, friction: 'verification' },
];

export function listScenarios() {
  return SCENARIOS;
}

export async function getActiveScenarios(env) {
  const rows = await sfQuery(env, `
    SELECT SCENARIO_ID, ACTIVATED_AT, ACTIVATED_BY, NOTES
    FROM IFF_SEAFOOD.OPS.ACTIVE_TARIFF_SCENARIOS
    WHERE DEACTIVATED_AT IS NULL
  `);
  return rows.map(r => ({
    ...SCENARIOS.find(s => s.id === r.SCENARIO_ID),
    activated_at: r.ACTIVATED_AT, activated_by: r.ACTIVATED_BY, notes: r.NOTES
  }));
}

export async function activateScenario(env, scenarioId, actorId, notes = '') {
  await sfExec(env, `
    INSERT INTO IFF_SEAFOOD.OPS.ACTIVE_TARIFF_SCENARIOS
      (SCENARIO_ID, ACTIVATED_AT, ACTIVATED_BY, NOTES) VALUES (?, ?, ?, ?)
  `, [scenarioId, new Date().toISOString(), actorId, notes]);
  return { scenario_id: scenarioId, status: 'active' };
}

export async function deactivateScenario(env, scenarioId, actorId) {
  await sfExec(env, `
    UPDATE IFF_SEAFOOD.OPS.ACTIVE_TARIFF_SCENARIOS
    SET DEACTIVATED_AT = ?, DEACTIVATED_BY = ?
    WHERE SCENARIO_ID = ? AND DEACTIVATED_AT IS NULL
  `, [new Date().toISOString(), actorId, scenarioId]);
  return { scenario_id: scenarioId, status: 'inactive' };
}

/**
 * Adjust landed cost given destination market and active scenarios.
 */
export async function adjustLandedCost(env, { species, form, market, baseCost }) {
  const active = await getActiveScenarios(env);
  let multiplier = 1.0;
  const applied = [];
  for (const s of active) {
    const matchSpecies = s.species === 'all' || s.species === species;
    const matchMarket = s.market === market;
    const matchForm = !s.form || s.form === form;
    if (matchSpecies && matchMarket && matchForm) {
      multiplier *= (1 + s.delta);
      applied.push(s.id);
    }
  }
  return {
    base_cost: baseCost,
    multiplier,
    adjusted_cost: baseCost * multiplier,
    scenarios_applied: applied
  };
}
