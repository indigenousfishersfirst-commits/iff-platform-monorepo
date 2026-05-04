// Auction watchdog — every 15 minutes, look for any AWARDED rows that haven't
// been turned into a settlement yet, and any PENDING rows whose start time has
// passed (Durable Object missed init).

import { Snowflake } from "../lib/snowflake.js";

export async function auctionWatchdog(env) {
  const sf = new Snowflake(env);

  // 1. Auto-open any PENDING auctions whose opens_at has passed
  const pending = await sf.query(`
    SELECT AUCTION_ID FROM MARKETPLACE.AUCTIONS
    WHERE STATUS = 'PENDING' AND OPENS_AT <= CURRENT_TIMESTAMP() LIMIT 100
  `, { schema: "MARKETPLACE" });
  for (const a of pending) {
    await sf.exec(`UPDATE MARKETPLACE.AUCTIONS SET STATUS='OPEN'
                   WHERE AUCTION_ID='${a.AUCTION_ID}'`,
                  { schema: "MARKETPLACE" });
  }

  // 2. Force-close any OPEN/EXTENDED auctions past closes_at
  const stuck = await sf.query(`
    SELECT AUCTION_ID FROM MARKETPLACE.AUCTIONS
    WHERE STATUS IN ('OPEN','EXTENDED') AND CLOSES_AT <= CURRENT_TIMESTAMP() LIMIT 100
  `, { schema: "MARKETPLACE" });
  for (const a of stuck) {
    const id  = env.AUCTION_ROOM.idFromName(a.AUCTION_ID);
    const obj = env.AUCTION_ROOM.get(id);
    await obj.fetch("https://do/init", {
      method: "POST",
      body: JSON.stringify({ auction_id: a.AUCTION_ID, force_close: true }),
    });
  }

  // 3. Queue settlement for AWARDED auctions without a settlement row
  const awarded = await sf.query(`
    SELECT a.AUCTION_ID FROM MARKETPLACE.AUCTIONS a
    LEFT JOIN MARKETPLACE.SETTLEMENTS s ON s.AUCTION_ID = a.AUCTION_ID
    WHERE a.STATUS = 'AWARDED' AND s.SETTLEMENT_ID IS NULL LIMIT 100
  `, { schema: "MARKETPLACE" });
  for (const a of awarded) {
    await env.IFF_JOBS.send({
      type: "settlement.run",
      payload: { auction_id: a.AUCTION_ID },
    });
  }

  return { opened: pending.length, closed: stuck.length, settled: awarded.length };
}
