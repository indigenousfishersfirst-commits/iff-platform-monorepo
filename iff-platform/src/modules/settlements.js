// Settlement processor — turns an AWARDED auction into a Stripe-ready row.
// Splits gross into platform fee, harvester payout, nation payout per
// MARKETPLACE.NATIONS.REVENUE_SHARE_PCT.

import { Snowflake } from "../lib/snowflake.js";

const PLATFORM_FEE_PCT = 0.06; // 6% — middle of the 5-8% range from PDF 2

export async function processSettlement(env, payload) {
  const sf = new Snowflake(env);
  const auctionId = payload?.auction_id;
  if (!auctionId) return;

  const rows = await sf.query(`
    SELECT a.AUCTION_ID, a.LOT_ID, a.SETTLEMENT_PRICE, a.HIGH_BIDDER_ID,
           l.QUANTITY, l.HARVESTER_ID, l.NATION_ID,
           n.REVENUE_SHARE_PCT
    FROM MARKETPLACE.AUCTIONS a
    JOIN MARKETPLACE.LOTS l    ON l.LOT_ID = a.LOT_ID
    LEFT JOIN MARKETPLACE.NATIONS n ON n.NATION_ID = l.NATION_ID
    WHERE a.AUCTION_ID = '${auctionId}' LIMIT 1
  `, { schema: "MARKETPLACE" });
  if (!rows.length) return;
  const r = rows[0];

  const gross = Number(r.SETTLEMENT_PRICE) * Number(r.QUANTITY);
  const fee   = gross * PLATFORM_FEE_PCT;
  const net   = gross - fee;
  const nationShare    = (Number(r.REVENUE_SHARE_PCT) || 0) / 100;
  const toNation       = net * nationShare * 0.10;          // 10% of net to Nation Trust
  const toHarvester    = net - toNation;
  const settlementId   = `STL_${crypto.randomUUID().slice(0, 12)}`;

  await sf.exec(`
    INSERT INTO MARKETPLACE.SETTLEMENTS
    (SETTLEMENT_ID, AUCTION_ID, LOT_ID, BUYER_ID, HARVESTER_ID, NATION_ID,
     GROSS_USD, PLATFORM_FEE_USD, PLATFORM_FEE_PCT, NET_TO_HARVESTER,
     NET_TO_NATION, PAYMENT_STATUS)
    SELECT '${settlementId}', '${r.AUCTION_ID}', '${r.LOT_ID}',
           '${r.HIGH_BIDDER_ID}', '${r.HARVESTER_ID || ""}',
           '${r.NATION_ID || ""}', ${gross.toFixed(2)}, ${fee.toFixed(2)},
           ${PLATFORM_FEE_PCT}, ${toHarvester.toFixed(2)},
           ${toNation.toFixed(2)}, 'PENDING'
  `, { schema: "MARKETPLACE" });

  // Trigger Stripe payment intent (stub — real impl posts to Stripe API)
  // await stripe.paymentIntents.create({...})

  // Notify harvester
  await env.IFF_JOBS.send({
    type: "notify.harvester",
    payload: {
      harvester_id: r.HARVESTER_ID,
      message: `Auction ${auctionId} settled. Net to you: $${toHarvester.toFixed(2)}.`,
    },
  });

  return { settlement_id: settlementId };
}

export async function runNightlySettlements(env) {
  // For any AWARDED auctions older than 1 hour with no settlement row,
  // fire-and-forget settlements via the queue.
  const sf = new Snowflake(env);
  const rows = await sf.query(`
    SELECT a.AUCTION_ID FROM MARKETPLACE.AUCTIONS a
    LEFT JOIN MARKETPLACE.SETTLEMENTS s ON s.AUCTION_ID = a.AUCTION_ID
    WHERE a.STATUS = 'AWARDED'
      AND a.AWARDED_AT <= DATEADD('hour', -1, CURRENT_TIMESTAMP())
      AND s.SETTLEMENT_ID IS NULL
    LIMIT 500
  `, { schema: "MARKETPLACE" });
  for (const r of rows)
    await env.IFF_JOBS.send({ type: "settlement.run", payload: { auction_id: r.AUCTION_ID } });
  return { queued: rows.length };
}
