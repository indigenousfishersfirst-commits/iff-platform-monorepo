// Queue consumer — fans messages out by `type`.

import { recomputeOneSignal }   from "../modules/consensus-engine.js";
import { processSettlement }    from "../modules/settlements.js";
import { notifyHarvester }      from "../modules/notifications.js";
import { syncOneTable }         from "../modules/snowflake-sync.js";
import { processResearchScan }  from "../modules/research.js";

const HANDLERS = {
  "signal.recompute":  recomputeOneSignal,
  "settlement.run":    processSettlement,
  "notify.harvester":  (env, payload) => notifyHarvester(env, payload.harvester_id, payload),
  "sync.table":        syncOneTable,
  "research.scan":     processResearchScan,
};

export async function handleQueue(batch, env, ctx) {
  for (const msg of batch.messages) {
    const { type, payload } = msg.body || {};
    const fn = HANDLERS[type];
    if (!fn) {
      console.warn("queue: no handler for", type);
      msg.ack();
      continue;
    }
    try {
      await fn(env, payload);
      msg.ack();
    } catch (err) {
      console.error("queue handler error", type, err);
      msg.retry({ delaySeconds: 30 });
    }
  }
}
