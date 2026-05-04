// /public/* — no auth required.
// QR landing pages, public traceability pages, healthz.

import { Hono } from "hono";
import { Snowflake } from "../lib/snowflake.js";

const r = new Hono();

// QR-scan landing: full hook-to-plate chain for a lot
r.get("/trace/:lotId", async (c) => {
  const sf = new Snowflake(c.env);
  const events = await sf.query(`
    SELECT EVENT_TYPE, EVENT_TIME, LOCATION_NAME, LATITUDE, LONGITUDE, TEMP_C, PHOTO_URL
    FROM MARKETPLACE.TRACEABILITY_EVENTS
    WHERE LOT_ID = '${c.req.param("lotId")}' ORDER BY EVENT_TIME
  `, { schema: "MARKETPLACE" });
  const lot = await sf.query(`
    SELECT l.LOT_ID, l.SPECIES, l.PRODUCT_FORM, l.HARVEST_DATE, l.HARVEST_AREA,
           h.DISPLAY_NAME AS HARVESTER, n.NATION_NAME AS NATION
    FROM MARKETPLACE.LOTS l
    LEFT JOIN MARKETPLACE.HARVESTERS h ON h.HARVESTER_ID = l.HARVESTER_ID
    LEFT JOIN MARKETPLACE.NATIONS    n ON n.NATION_ID    = l.NATION_ID
    WHERE l.LOT_ID = '${c.req.param("lotId")}' LIMIT 1
  `, { schema: "MARKETPLACE" });
  return c.json({ lot: lot[0] || null, events });
});

r.get("/signals/highlights", async (c) => {
  // Lightweight, anonymous endpoint that powers the public Pages site
  const rs = await c.env.IFF_D1.prepare(`
    SELECT envelope FROM signals_cache
    WHERE json_extract(envelope, '$.action') IN ('BUY','SELL')
      AND as_of >= datetime('now', '-2 days')
    ORDER BY as_of DESC LIMIT 10
  `).all();
  const out = rs.results.map((r) => JSON.parse(r.envelope));
  return c.json({ signals: out });
});

export default r;
