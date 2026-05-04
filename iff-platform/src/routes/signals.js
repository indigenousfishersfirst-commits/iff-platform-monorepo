// /v1/signals — unified read for CS01..CS08, M11/M16/M19, TS-001..TS-012,
// 28 indicators, 12 patterns. Reads from D1 cache; falls back to Snowflake.

import { Hono } from "hono";
import { Snowflake } from "../lib/snowflake.js";
import { validateEnvelope } from "../lib/envelope.js";

const r = new Hono();

// GET /v1/signals?species=SOCKEYE&kind=composite&limit=20
r.get("/", async (c) => {
  const { species, market, kind, action, since } = c.req.query();
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);

  const filters = [];
  if (species) filters.push(`json_extract(envelope, '$.scope.species') = '${species}'`);
  if (market)  filters.push(`json_extract(envelope, '$.scope.market')  = '${market}'`);
  if (kind)    filters.push(`kind = '${kind}'`);
  if (action)  filters.push(`json_extract(envelope, '$.action') = '${action}'`);
  if (since)   filters.push(`as_of >= '${since}'`);

  const where = filters.length ? "WHERE " + filters.join(" AND ") : "";
  const sql = `
    SELECT id, kind, as_of, envelope
    FROM signals_cache
    ${where}
    ORDER BY as_of DESC
    LIMIT ${limit}
  `;
  const rs = await c.env.IFF_D1.prepare(sql).all();
  const out = rs.results.map((row) => JSON.parse(row.envelope));
  return c.json({ signals: out, count: out.length });
});

// GET /v1/signals/:id — full envelope incl. driver provenance
r.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.IFF_D1.prepare(
    "SELECT envelope FROM signals_cache WHERE id = ? LIMIT 1",
  ).bind(id).first();
  if (row) return c.json(JSON.parse(row.envelope));

  // fall back to Snowflake authoritative
  const sf = new Snowflake(c.env);
  const rows = await sf.query(`
    SELECT ENVELOPE FROM OPS.SIGNALS_FEED
    WHERE ID = '${id}'
    ORDER BY AS_OF DESC LIMIT 1
  `);
  if (!rows.length) return c.json({ error: "not_found" }, 404);
  return c.json(JSON.parse(rows[0].ENVELOPE));
});

// POST /v1/signals/recompute — admin only; queues a recompute job
r.post("/recompute", async (c) => {
  const u = c.get("user");
  if (!["iff_admin", "iff_operator"].includes(u.role))
    return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => ({}));
  await c.env.IFF_JOBS.send({ type: "signal.recompute", payload: body });
  return c.json({ queued: true });
});

export default r;
