// /v1/auctions — list & open; live bidding goes through /ws/auction/:id (DO).

import { Hono } from "hono";
import { Snowflake } from "../lib/snowflake.js";

const r = new Hono();

r.get("/", async (c) => {
  const { status = "OPEN" } = c.req.query();
  const rs = await c.env.IFF_D1.prepare(`
    SELECT auction_id, lot_id, auction_type, current_price, reserve_price,
           bid_count, opens_at, closes_at, status
    FROM auctions_cache WHERE status = ?
    ORDER BY closes_at LIMIT 500
  `).bind(status).all();
  return c.json({ auctions: rs.results });
});

r.post("/", async (c) => {
  const u = c.get("user");
  if (!["iff_admin", "iff_operator", "nation_admin"].includes(u.role))
    return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json();
  const id = `AUC_${crypto.randomUUID().slice(0, 8)}`;
  const sf = new Snowflake(c.env);
  await sf.exec(`
    INSERT INTO MARKETPLACE.AUCTIONS
    (AUCTION_ID, LOT_ID, AUCTION_TYPE, OPENS_AT, CLOSES_AT,
     EXTEND_ON_BID_SECS, START_PRICE, RESERVE_PRICE, DECREMENT,
     DECREMENT_INTERVAL_SECS, CURRENT_PRICE, STATUS)
    SELECT '${id}', '${body.lot_id}', '${body.auction_type}',
           '${body.opens_at}', '${body.closes_at}',
           ${body.extend_on_bid_secs || 60}, ${body.start_price},
           ${body.reserve_price || "NULL"}, ${body.decrement || "NULL"},
           ${body.decrement_interval_secs || "NULL"},
           ${body.start_price}, 'PENDING'
  `, { schema: "MARKETPLACE" });

  // Pre-warm the Durable Object
  const objId = c.env.AUCTION_ROOM.idFromName(id);
  const obj   = c.env.AUCTION_ROOM.get(objId);
  await obj.fetch("https://do/init", {
    method: "POST",
    body: JSON.stringify({ auction_id: id, ...body }),
  });

  return c.json({ auction_id: id, ws: `/ws/auction/${id}` }, 201);
});

export default r;
