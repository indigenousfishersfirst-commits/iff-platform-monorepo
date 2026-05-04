// Bidirectional Snowflake ↔ D1 sync.
// D1 holds 30-day hot windows of: signals_cache, lots_cache, auctions_cache,
// settlements_cache. Truth is Snowflake.

import { Snowflake } from "../lib/snowflake.js";

const TABLES = {
  signals_cache: {
    sf: "OPS.SIGNALS_FEED",
    cols: ["ID", "KIND", "AS_OF", "ENVELOPE"],
    where: "AS_OF >= DATEADD('day', -30, CURRENT_TIMESTAMP())",
    pk: "id",
    insert: `INSERT OR REPLACE INTO signals_cache
             (id, kind, as_of, envelope) VALUES (?, ?, ?, ?)`,
    map: (r) => [r.ID, r.KIND, r.AS_OF, r.ENVELOPE],
  },
  lots_cache: {
    sf: "MARKETPLACE.LOTS",
    cols: ["LOT_ID", "LOT_TYPE", "HARVESTER_ID", "NATION_ID", "SPECIES",
           "PRODUCT_FORM", "GRADE", "QUANTITY", "UNIT", "HARVEST_DATE",
           "STATUS", "UPDATED_AT"],
    where: "UPDATED_AT >= DATEADD('day', -30, CURRENT_TIMESTAMP())",
    pk: "lot_id",
    insert: `INSERT OR REPLACE INTO lots_cache
             (lot_id, lot_type, harvester_id, nation_id, species, product_form,
              grade, quantity, unit, harvest_date, status, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    map: (r) => [r.LOT_ID, r.LOT_TYPE, r.HARVESTER_ID, r.NATION_ID, r.SPECIES,
                 r.PRODUCT_FORM, r.GRADE, r.QUANTITY, r.UNIT, r.HARVEST_DATE,
                 r.STATUS, r.UPDATED_AT],
  },
  auctions_cache: {
    sf: "MARKETPLACE.AUCTIONS",
    cols: ["AUCTION_ID", "LOT_ID", "AUCTION_TYPE", "OPENS_AT", "CLOSES_AT",
           "CURRENT_PRICE", "RESERVE_PRICE", "BID_COUNT", "STATUS"],
    where: "STATUS IN ('OPEN','EXTENDED','PENDING','AWARDED','CLOSED')",
    pk: "auction_id",
    insert: `INSERT OR REPLACE INTO auctions_cache
             (auction_id, lot_id, auction_type, opens_at, closes_at,
              current_price, reserve_price, bid_count, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    map: (r) => [r.AUCTION_ID, r.LOT_ID, r.AUCTION_TYPE, r.OPENS_AT,
                 r.CLOSES_AT, r.CURRENT_PRICE, r.RESERVE_PRICE,
                 r.BID_COUNT, r.STATUS],
  },
  settlements_cache: {
    sf: "MARKETPLACE.SETTLEMENTS",
    cols: ["SETTLEMENT_ID", "AUCTION_ID", "LOT_ID", "BUYER_ID", "HARVESTER_ID",
           "NATION_ID", "GROSS_USD", "PLATFORM_FEE_USD", "NET_TO_HARVESTER",
           "NET_TO_NATION", "PAYMENT_STATUS", "SETTLED_AT"],
    where: "SETTLED_AT >= DATEADD('day', -90, CURRENT_TIMESTAMP())",
    pk: "settlement_id",
    insert: `INSERT OR REPLACE INTO settlements_cache
             (settlement_id, auction_id, lot_id, buyer_id, harvester_id,
              nation_id, gross_usd, platform_fee_usd, net_to_harvester,
              net_to_nation, payment_status, settled_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    map: (r) => [r.SETTLEMENT_ID, r.AUCTION_ID, r.LOT_ID, r.BUYER_ID,
                 r.HARVESTER_ID, r.NATION_ID, r.GROSS_USD, r.PLATFORM_FEE_USD,
                 r.NET_TO_HARVESTER, r.NET_TO_NATION, r.PAYMENT_STATUS,
                 r.SETTLED_AT],
  },
};

export async function syncSnowflakeToD1(env) {
  const sf = new Snowflake(env);
  let total = 0;
  for (const [name, t] of Object.entries(TABLES)) {
    try {
      const sql = `SELECT ${t.cols.join(", ")} FROM ${t.sf} WHERE ${t.where}`;
      const rows = await sf.query(sql);
      const stmt = env.IFF_D1.prepare(t.insert);
      // Batch into D1 prepared-statement bulks of 50
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50).map((r) => stmt.bind(...t.map(r)));
        await env.IFF_D1.batch(batch);
      }
      total += rows.length;
      console.log(`[sync] ${name}: ${rows.length} rows`);
    } catch (e) {
      console.error(`[sync] ${name} failed`, e.message);
    }
  }
  return { rows: total };
}

export async function syncOneTable(env, payload) {
  const t = TABLES[payload?.table];
  if (!t) return { rows: 0 };
  return syncSnowflakeToD1(env);
}
