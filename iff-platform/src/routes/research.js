// /v1/research — Perplexity bridge.
// Research scans land here, get parsed, get written to RESEARCH.* schema.

import { Hono } from "hono";
import { Snowflake } from "../lib/snowflake.js";

const r = new Hono();

// POST /v1/research/scan
// Body shape:
// {
//   topic: "China lobster tariff Mar 2026",
//   findings: [{ statement, citation_url, confidence }],
//   variables_proposed: [{ name, definition, source_url, candidate_for }],
//   competitors: [{ name, signal, value, currency, source_url }],
//   regulatory: [{ jurisdiction, rule, effective_date, source_url }]
// }
r.post("/scan", async (c) => {
  const u = c.get("user");
  if (!["iff_admin", "iff_operator"].includes(u.role))
    return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json();
  const scanId = `SCAN_${crypto.randomUUID().slice(0, 12)}`;
  const sf = new Snowflake(c.env);

  await sf.exec(`
    INSERT INTO RESEARCH.SCANS (SCAN_ID, TOPIC, RAW_PAYLOAD, CREATED_BY, CREATED_AT)
    SELECT '${scanId}', '${body.topic.replaceAll("'", "''")}',
           PARSE_JSON('${JSON.stringify(body).replaceAll("'", "''")}'),
           '${u.sub}', CURRENT_TIMESTAMP()
  `, { schema: "RESEARCH" });

  if (body.variables_proposed?.length) {
    await sf.batchInsert(
      "RESEARCH.VARIABLES",
      ["VAR_ID", "NAME", "DEFINITION", "SOURCE_URL", "CANDIDATE_FOR", "STATUS", "PROPOSED_BY"],
      body.variables_proposed.map((v) => ({
        VAR_ID: `VAR_${crypto.randomUUID().slice(0, 8)}`,
        NAME: v.name,
        DEFINITION: v.definition,
        SOURCE_URL: v.source_url,
        CANDIDATE_FOR: v.candidate_for,
        STATUS: "PROPOSED",
        PROPOSED_BY: u.sub,
      })),
      { schema: "RESEARCH" },
    );
  }
  if (body.competitors?.length) {
    await sf.batchInsert(
      "RESEARCH.COMPETITORS",
      ["OBS_ID", "NAME", "SIGNAL", "VALUE", "CURRENCY", "SOURCE_URL", "OBSERVED_AT"],
      body.competitors.map((c2) => ({
        OBS_ID: `COMP_${crypto.randomUUID().slice(0, 8)}`,
        NAME: c2.name,
        SIGNAL: c2.signal,
        VALUE: c2.value,
        CURRENCY: c2.currency,
        SOURCE_URL: c2.source_url,
        OBSERVED_AT: new Date().toISOString(),
      })),
      { schema: "RESEARCH" },
    );
  }
  if (body.regulatory?.length) {
    await sf.batchInsert(
      "RESEARCH.REGULATORY",
      ["RULE_ID", "JURISDICTION", "RULE", "EFFECTIVE_DATE", "SOURCE_URL"],
      body.regulatory.map((reg) => ({
        RULE_ID: `REG_${crypto.randomUUID().slice(0, 8)}`,
        JURISDICTION: reg.jurisdiction,
        RULE: reg.rule,
        EFFECTIVE_DATE: reg.effective_date,
        SOURCE_URL: reg.source_url,
      })),
      { schema: "RESEARCH" },
    );
    // Trigger tariff scenario rebuild
    await c.env.IFF_JOBS.send({ type: "signal.recompute", payload: { kind: "tariff" } });
  }

  return c.json({ scan_id: scanId, accepted: true });
});

// GET /v1/research/variables?status=PROPOSED
r.get("/variables", async (c) => {
  const status = c.req.query("status") || "PROPOSED";
  const sf = new Snowflake(c.env);
  const rows = await sf.query(`
    SELECT VAR_ID, NAME, DEFINITION, SOURCE_URL, CANDIDATE_FOR, STATUS
    FROM RESEARCH.VARIABLES WHERE STATUS = '${status}' ORDER BY VAR_ID DESC LIMIT 200
  `, { schema: "RESEARCH" });
  return c.json({ variables: rows });
});

// POST /v1/research/variables/:id/promote — admin moves PROPOSED → ACTIVE
r.post("/variables/:id/promote", async (c) => {
  const u = c.get("user");
  if (u.role !== "iff_admin") return c.json({ error: "forbidden" }, 403);
  const sf = new Snowflake(c.env);
  await sf.exec(`
    UPDATE RESEARCH.VARIABLES SET STATUS = 'ACTIVE',
      PROMOTED_BY = '${u.sub}', PROMOTED_AT = CURRENT_TIMESTAMP()
    WHERE VAR_ID = '${c.req.param("id")}'
  `, { schema: "RESEARCH" });
  return c.json({ ok: true });
});

export default r;
