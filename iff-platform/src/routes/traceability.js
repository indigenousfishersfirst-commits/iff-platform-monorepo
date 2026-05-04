// /v1/traceability — log events, fetch chain, generate QR landing pages.

import { Hono } from "hono";
import { Snowflake } from "../lib/snowflake.js";

const r = new Hono();

r.post("/events", async (c) => {
  const body = await c.req.json();
  const sf = new Snowflake(c.env);
  const id = `EV_${crypto.randomUUID().slice(0, 12)}`;
  await sf.exec(`
    INSERT INTO MARKETPLACE.TRACEABILITY_EVENTS
    (EVENT_ID, LOT_ID, EVENT_TYPE, EVENT_TIME, LATITUDE, LONGITUDE,
     LOCATION_NAME, ACTOR_ID, TEMP_C, PHOTO_URL, QR_CODE_URL, METADATA)
    SELECT '${id}', '${body.lot_id}', '${body.event_type}',
           CURRENT_TIMESTAMP(), ${body.latitude || "NULL"}, ${body.longitude || "NULL"},
           '${body.location_name || ""}', '${body.actor_id || c.get("user")?.sub}',
           ${body.temp_c ?? "NULL"}, '${body.photo_url || ""}',
           'https://api.cantekhi.com/public/trace/${body.lot_id}',
           PARSE_JSON('${JSON.stringify(body.metadata || {})}')
  `, { schema: "MARKETPLACE" });
  return c.json({ event_id: id }, 201);
});

r.get("/lot/:lotId", async (c) => {
  const sf = new Snowflake(c.env);
  const events = await sf.query(`
    SELECT EVENT_ID, EVENT_TYPE, EVENT_TIME, LATITUDE, LONGITUDE,
           LOCATION_NAME, ACTOR_ID, TEMP_C, PHOTO_URL
    FROM MARKETPLACE.TRACEABILITY_EVENTS
    WHERE LOT_ID = '${c.req.param("lotId")}' ORDER BY EVENT_TIME
  `, { schema: "MARKETPLACE" });
  return c.json({ lot_id: c.req.param("lotId"), events });
});

export default r;
