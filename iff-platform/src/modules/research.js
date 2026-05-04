// modules/research.js
// Perplexity research bridge → variables → Snowflake RESEARCH schema → Granger feed promotion

import { sfQuery, sfExec, sfBatchInsert } from '../lib/snowflake.js';
import { buildEnvelope, KIND, ACTION } from '../lib/envelope.js';

/**
 * processResearchScan
 * Triggered by cron (twice daily) or by manual POST /v1/research/scans
 * Pulls latest Perplexity research artifacts, extracts variables,
 * loads them into Snowflake RESEARCH.SCANS + RESEARCH.VARIABLES.
 */
export async function processResearchScan(env, { topic = null, scanId = null } = {}) {
  const now = new Date().toISOString();
  const id = scanId || crypto.randomUUID();

  // 1. Fetch Perplexity research result if topic provided
  let result = null;
  if (topic && env.PERPLEXITY_API_KEY) {
    try {
      const resp = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'sonar-pro',
          messages: [
            { role: 'system', content: 'You are a seafood market research analyst. Return concise quantitative findings with sources.' },
            { role: 'user', content: topic }
          ]
        })
      });
      if (resp.ok) {
        const j = await resp.json();
        result = j.choices?.[0]?.message?.content || null;
      }
    } catch (e) {
      console.warn('perplexity api failed:', e.message);
    }
  }

  // 2. Persist scan to Snowflake
  await sfExec(env, `
    INSERT INTO IFF_SEAFOOD.RESEARCH.SCANS (SCAN_ID, TOPIC, RESULT, RAN_AT, STATUS)
    SELECT ?, ?, PARSE_JSON(?), ?, ?
  `, [id, topic, JSON.stringify({ text: result }), now, result ? 'completed' : 'pending']);

  // 3. Cache scan summary in R2 for quick retrieval
  if (env.RESEARCH_BUCKET && result) {
    await env.RESEARCH_BUCKET.put(
      `scans/${id}.json`,
      JSON.stringify({ id, topic, result, ran_at: now }),
      { httpMetadata: { contentType: 'application/json' } }
    );
  }

  return { scan_id: id, ran_at: now, has_result: !!result };
}

/**
 * extractVariablesFromScan
 * Lightweight rule-based extraction (production version uses LLM JSON mode).
 * Looks for patterns like "X price = $Y/kg" or "Z increased N%".
 */
export async function extractVariablesFromScan(env, scanId) {
  const rows = await sfQuery(env,
    `SELECT TOPIC, RESULT FROM IFF_SEAFOOD.RESEARCH.SCANS WHERE SCAN_ID = ?`,
    [scanId]
  );
  if (!rows.length) return { extracted: 0 };

  const text = rows[0].RESULT?.text || '';
  const variables = [];

  // Currency / price extraction
  const priceRe = /(\b[A-Z][a-z]+(?:\s[a-z]+)?)\s+(?:price|priced|sells?|trading|at)\s+(?:at\s+)?(?:USD|CAD|JPY|EUR)?\s?\$?(\d+(?:\.\d+)?)\s?(?:\/(?:kg|lb|piece))?/gi;
  let m;
  while ((m = priceRe.exec(text)) !== null) {
    variables.push({
      variable_name: `${m[1].toLowerCase().replace(/\s+/g, '_')}_price`,
      value: parseFloat(m[2]),
      unit: 'USD/kg',
      source_scan_id: scanId
    });
  }

  // Percent change extraction
  const pctRe = /(\b[A-Z][a-z]+(?:\s[a-z]+){0,2})\s+(?:increased|rose|jumped|fell|dropped|declined)\s+(?:by\s+)?(\d+(?:\.\d+)?)%/gi;
  while ((m = pctRe.exec(text)) !== null) {
    variables.push({
      variable_name: `${m[1].toLowerCase().replace(/\s+/g, '_')}_pct_change`,
      value: parseFloat(m[2]),
      unit: 'percent',
      source_scan_id: scanId
    });
  }

  if (variables.length) {
    await sfBatchInsert(env, 'IFF_SEAFOOD.RESEARCH.VARIABLES',
      ['VARIABLE_NAME', 'VALUE', 'UNIT', 'SOURCE_SCAN_ID', 'EXTRACTED_AT'],
      variables.map(v => [v.variable_name, v.value, v.unit, v.source_scan_id, new Date().toISOString()])
    );
  }

  return { extracted: variables.length, variables };
}

/**
 * promoteVariableToSignalsFeed
 * Once a research variable has been validated, promote it to OPS.SIGNALS_FEED
 * so it becomes available to the Granger causality tests and consensus engine.
 */
export async function promoteVariableToSignalsFeed(env, { variableName, signalId, kind = KIND.INDICATOR }) {
  const rows = await sfQuery(env, `
    SELECT VARIABLE_NAME, VALUE, UNIT, SOURCE_SCAN_ID, EXTRACTED_AT
    FROM IFF_SEAFOOD.RESEARCH.VARIABLES
    WHERE VARIABLE_NAME = ?
    ORDER BY EXTRACTED_AT DESC
    LIMIT 1
  `, [variableName]);

  if (!rows.length) return { promoted: false, reason: 'variable not found' };
  const v = rows[0];

  const env_obj = buildEnvelope({
    kind,
    signal_id: signalId,
    species: null,
    value: v.VALUE,
    unit: v.UNIT,
    confidence: 0.5,
    direction: null,
    inputs: { source: 'perplexity', variable: v.VARIABLE_NAME },
    sources: [{ kind: 'perplexity_scan', id: v.SOURCE_SCAN_ID }],
    computed_at: new Date().toISOString()
  });

  await sfExec(env, `
    INSERT INTO IFF_SEAFOOD.OPS.SIGNALS_FEED
      (SIGNAL_ID, KIND, SPECIES, VALUE, UNIT, CONFIDENCE, ENVELOPE, COMPUTED_AT)
    SELECT ?, ?, ?, ?, ?, ?, PARSE_JSON(?), ?
  `, [
    signalId, kind, null, v.VALUE, v.UNIT, 0.5,
    JSON.stringify(env_obj), env_obj.computed_at
  ]);

  return { promoted: true, signal_id: signalId };
}

/**
 * regulatoryWatch — scheduled scan for new regulations affecting harvest
 */
export async function regulatoryWatch(env) {
  const topics = [
    'DFO Pacific salmon allocation 2026',
    'BC herring spawn-on-kelp opening 2026',
    'Japan tuna import tariff updates',
    'EU IUU fishing yellow card status Canada',
    'CFIA seafood traceability rule changes 2026'
  ];

  const results = [];
  for (const topic of topics) {
    const r = await processResearchScan(env, { topic });
    results.push(r);
  }
  return { scanned: results.length, scans: results };
}
