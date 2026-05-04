// /v1/settlements — Stripe webhook lands here; ledger queries served from D1.

import { Hono } from "hono";
import { Snowflake } from "../lib/snowflake.js";

const r = new Hono();

r.post("/stripe-webhook", async (c) => {
  const sig = c.req.header("stripe-signature");
  const raw = await c.req.text();
  // signature verification would go here; using shared secret in env
  const evt = JSON.parse(raw);

  if (evt.type === "payment_intent.succeeded") {
    const pi = evt.data.object;
    const sf = new Snowflake(c.env);
    await sf.exec(`
      UPDATE MARKETPLACE.SETTLEMENTS
      SET PAYMENT_STATUS = 'PAID', SETTLED_AT = CURRENT_TIMESTAMP(),
          STRIPE_PAYMENT_ID = '${pi.id}'
      WHERE SETTLEMENT_ID = '${pi.metadata?.settlement_id || ""}'
    `, { schema: "MARKETPLACE" });
  }
  return c.json({ received: true });
});

r.get("/", async (c) => {
  const u = c.get("user");
  const limit = 100;
  const filters = [];
  if (u.role === "harvester") filters.push(`harvester_id = '${u.sub}'`);
  if (u.role === "nation_admin" && u.nation_id)
    filters.push(`nation_id = '${u.nation_id}'`);
  const where = filters.length ? "WHERE " + filters.join(" AND ") : "";
  const rs = await c.env.IFF_D1.prepare(
    `SELECT * FROM settlements_cache ${where}
     ORDER BY settled_at DESC LIMIT ${limit}`,
  ).all();
  return c.json({ settlements: rs.results });
});

export default r;
