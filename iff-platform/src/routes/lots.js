// /v1/lots — list, create, update lots (5 types A_SPOT..E_EXPERIENCE)

import { Hono } from "hono";
import { Snowflake } from "../lib/snowflake.js";

const r = new Hono();

r.get("/", async (c) => {
  const { species, lot_type, nation_id, status } = c.req.query();
  const filters = ["1=1"];
  if (species)   filters.push(`species = '${species}'`);
  if (lot_type)  filters.push(`lot_type = '${lot_type}'`);
  if (nation_id) filters.push(`nation_id = '${nation_id}'`);
  if (status)    filters.push(`status = '${status}'`);
  const sql = `
    SELECT lot_id, lot_type, species, product_form, grade, quantity, unit,
           harvest_date, harvester_id, nation_id, status,
           strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updated_at
    FROM lots_cache WHERE ${filters.join(" AND ")}
    ORDER BY updated_at DESC LIMIT 500
  `;
  const rs = await c.env.IFF_D1.prepare(sql).all();
  return c.json({ lots: rs.results });
});

r.post("/", async (c) => {
  const u = c.get("user");
  if (!["iff_admin", "iff_operator", "harvester", "nation_admin"].includes(u.role))
    return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json();

  // Validate harvester writes only their own lots
  if (u.role === "harvester" && body.harvester_id !== u.sub)
    return c.json({ error: "harvester_id_mismatch" }, 403);

  const sf = new Snowflake(c.env);
  const lotId = `LOT_${crypto.randomUUID().slice(0, 8)}`;
  await sf.exec(`
    INSERT INTO MARKETPLACE.LOTS
    (LOT_ID, LOT_TYPE, HARVESTER_ID, NATION_ID, SPECIES, PRODUCT_FORM, GRADE,
     QUANTITY, UNIT, HARVEST_DATE, HARVEST_AREA, AVAILABLE_FROM,
     AVAILABLE_UNTIL, PICKUP_LOCATION, COLD_CHAIN_FLAG, STATUS, METADATA)
    SELECT '${lotId}', '${body.lot_type}', '${body.harvester_id || ""}',
           '${body.nation_id || ""}', '${body.species}', '${body.product_form}',
           '${body.grade || ""}', ${Number(body.quantity)}, '${body.unit || "lb"}',
           '${body.harvest_date}', '${body.harvest_area || ""}',
           CURRENT_TIMESTAMP(), DATEADD('day', 7, CURRENT_TIMESTAMP()),
           '${body.pickup_location || ""}', TRUE, 'LISTED',
           PARSE_JSON('${JSON.stringify(body.metadata || {})}')
  `, { schema: "MARKETPLACE" });

  await c.env.IFF_JOBS.send({ type: "sync.table", payload: { table: "lots" } });
  return c.json({ lot_id: lotId, status: "LISTED" }, 201);
});

r.patch("/:id", async (c) => {
  const u = c.get("user");
  if (!["iff_admin", "iff_operator"].includes(u.role))
    return c.json({ error: "forbidden" }, 403);
  const lotId = c.req.param("id");
  const body  = await c.req.json();
  const sets  = Object.entries(body)
    .map(([k, v]) => `${k.toUpperCase()} = ${typeof v === "number" ? v : `'${v}'`}`)
    .join(", ");
  const sf = new Snowflake(c.env);
  await sf.exec(`UPDATE MARKETPLACE.LOTS SET ${sets} WHERE LOT_ID = '${lotId}'`,
                { schema: "MARKETPLACE" });
  return c.json({ ok: true });
});

export default r;
