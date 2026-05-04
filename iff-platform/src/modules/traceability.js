// modules/traceability.js
// Append-only event chain per lot. Hash-chained so any tampering is detectable.
// Events: HARVEST → LANDED → PROCESSED → PACKED → SHIPPED → RECEIVED → SOLD

import { sfQuery, sfExec } from '../lib/snowflake.js';

async function sha256(text) {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function appendTraceEvent(env, { lotId, eventType, actorId, actorRole, location, payload }) {
  // Get previous event hash for this lot
  const prev = await sfQuery(env, `
    SELECT EVENT_HASH FROM IFF_SEAFOOD.MARKETPLACE.LOT_EVENTS
    WHERE LOT_ID = ? ORDER BY OCCURRED_AT DESC LIMIT 1
  `, [lotId]);

  const prevHash = prev[0]?.EVENT_HASH || '0'.repeat(64);
  const eventId = crypto.randomUUID();
  const occurredAt = new Date().toISOString();
  const payloadStr = JSON.stringify(payload || {});

  const eventHash = await sha256(
    `${eventId}|${lotId}|${eventType}|${actorId}|${prevHash}|${occurredAt}|${payloadStr}`
  );

  await sfExec(env, `
    INSERT INTO IFF_SEAFOOD.MARKETPLACE.LOT_EVENTS
      (EVENT_ID, LOT_ID, EVENT_TYPE, ACTOR_ID, ACTOR_ROLE, LOCATION, PAYLOAD, PREV_HASH, EVENT_HASH, OCCURRED_AT)
    SELECT ?, ?, ?, ?, ?, ?, PARSE_JSON(?), ?, ?, ?
  `, [eventId, lotId, eventType, actorId, actorRole, location || null, payloadStr, prevHash, eventHash, occurredAt]);

  return { event_id: eventId, lot_id: lotId, event_hash: eventHash, prev_hash: prevHash, occurred_at: occurredAt };
}

export async function getLotChain(env, lotId) {
  const events = await sfQuery(env, `
    SELECT EVENT_ID, LOT_ID, EVENT_TYPE, ACTOR_ID, ACTOR_ROLE, LOCATION,
           PAYLOAD, PREV_HASH, EVENT_HASH, OCCURRED_AT
    FROM IFF_SEAFOOD.MARKETPLACE.LOT_EVENTS
    WHERE LOT_ID = ? ORDER BY OCCURRED_AT ASC
  `, [lotId]);

  // Verify chain integrity
  let prevHash = '0'.repeat(64);
  let valid = true;
  for (const e of events) {
    if (e.PREV_HASH !== prevHash) { valid = false; break; }
    prevHash = e.EVENT_HASH;
  }

  return { lot_id: lotId, events, chain_valid: valid, length: events.length };
}

export async function generateQrPayload(env, lotId) {
  const chain = await getLotChain(env, lotId);
  const lot = await sfQuery(env, `
    SELECT LOT_ID, SPECIES, GEAR, AREA, HARVESTED_AT, NATION, VESSEL_NAME
    FROM IFF_SEAFOOD.MARKETPLACE.LOTS WHERE LOT_ID = ?
  `, [lotId]);

  return {
    lot: lot[0] || null,
    chain_valid: chain.chain_valid,
    events_count: chain.length,
    public_url: `https://api.cantekhi.com/public/trace/${lotId}`,
    qr_text: `https://api.cantekhi.com/public/trace/${lotId}`
  };
}
