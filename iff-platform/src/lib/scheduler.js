// Cron router — maps wrangler cron expressions to handler functions.
// All ingestion handlers live in modules/ingest.js as a single grouped module.

import { syncSnowflakeToD1 }       from "../modules/snowflake-sync.js";
import { recomputeAllSignals }     from "../modules/consensus-engine.js";
import {
  ingestToyosuPrices,
  ingestDieselPrices,
  ingestGoogleTrends,
  ingestNoaaEnv,
  ingestFAOReports,
  ingestPdoEnso,
  ingestFxRates,
  ingestDfoOpenings,
  ingestVesselAIS,
} from "../modules/ingest.js";
import { auctionWatchdog }         from "../modules/auction.js";
import { runNightlySettlements }   from "../modules/settlements.js";
import { regulatoryWatch }         from "../modules/research.js";

const ROUTES = {
  "*/5 * * * *":    [syncSnowflakeToD1, recomputeAllSignals],
  "0 */1 * * *":    [ingestToyosuPrices, ingestDieselPrices, ingestGoogleTrends, ingestFxRates],
  "0 */6 * * *":    [ingestNoaaEnv, ingestVesselAIS, ingestDfoOpenings],
  "0 7 * * *":      [ingestNoaaEnv],
  "0 9 * * 1":      [ingestFAOReports, regulatoryWatch],
  "0 1 1 * *":      [ingestPdoEnso],
  "*/15 * * * *":   [auctionWatchdog],
  "0 17 * * *":     [runNightlySettlements],
};

export async function runScheduled(event, env, ctx) {
  const handlers = ROUTES[event.cron] ?? [];
  console.log(`[cron] ${event.cron} → ${handlers.length} handlers`);
  const results = await Promise.allSettled(handlers.map((h) => h(env, ctx)));
  for (const r of results) {
    if (r.status === "rejected") console.error("[cron]", r.reason);
    else console.log("[cron] ok", JSON.stringify(r.value));
  }
}
