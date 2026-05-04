// Snowflake REST helper — used by every ingest module and every read route
// that needs a freshness check beyond the D1 cache.

const TIMEOUT_DEFAULT = 60;

export class Snowflake {
  constructor(env) {
    this.account   = env.SNOWFLAKE_ACCOUNT;
    this.warehouse = env.SNOWFLAKE_WAREHOUSE;
    this.database  = env.SNOWFLAKE_DATABASE;
    this.pat       = env.SNOWFLAKE_PAT;
    this.endpoint  = `https://${this.account}.snowflakecomputing.com/api/v2/statements`;
  }

  async exec(sql, { schema = "OPS", timeout = TIMEOUT_DEFAULT, params } = {}) {
    const body = {
      statement: sql,
      warehouse: this.warehouse,
      database:  this.database,
      schema,
      timeout,
      ...(params ? { bindings: params } : {}),
    };
    const r = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.pat}`,
        "content-type":  "application/json",
        "accept":        "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`snowflake ${r.status}: ${text.slice(0, 500)}`);
    }
    return r.json();
  }

  // Convenience: SELECT → array of row objects
  async query(sql, opts) {
    const j = await this.exec(sql, opts);
    const cols = (j.resultSetMetaData?.rowType ?? []).map((c) => c.name);
    return (j.data ?? []).map((row) =>
      Object.fromEntries(cols.map((c, i) => [c, row[i]])),
    );
  }

  // Batch insert with VALUES chunking — Snowflake REST request body is ~1 MB
  async batchInsert(table, columns, rows, { chunk = 500, schema } = {}) {
    if (!rows.length) return 0;
    let total = 0;
    const colList = columns.join(", ");
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      const values = slice
        .map(
          (r) =>
            "(" +
            columns
              .map((c) => formatValue(r[c]))
              .join(", ") +
            ")",
        )
        .join(", ");
      const sql =
        `INSERT INTO ${table} (${colList}) VALUES ${values}`;
      const j = await this.exec(sql, { schema });
      total += Number(j?.stats?.numRowsInserted ?? 0);
    }
    return total;
  }

  // MERGE upsert via VALUES
  async upsert(table, keys, columns, rows, { schema } = {}) {
    if (!rows.length) return 0;
    const colList = columns.join(", ");
    const valuesSql = rows
      .map(
        (r) =>
          "(" +
          columns
            .map((c) => formatValue(r[c]))
            .join(", ") +
          ")",
      )
      .join(", ");
    const onClause = keys.map((k) => `t.${k} = s.${k}`).join(" AND ");
    const updateSet = columns
      .filter((c) => !keys.includes(c))
      .map((c) => `${c} = s.${c}`)
      .join(", ");
    const sql = `
      MERGE INTO ${table} t
      USING (SELECT * FROM VALUES ${valuesSql} AS v(${colList})) s
      ON ${onClause}
      WHEN MATCHED THEN UPDATE SET ${updateSet}
      WHEN NOT MATCHED THEN INSERT (${colList})
        VALUES (${columns.map((c) => `s.${c}`).join(", ")})
    `;
    const j = await this.exec(sql, { schema });
    return Number(j?.stats?.numRowsInserted ?? 0) +
           Number(j?.stats?.numRowsUpdated ?? 0);
  }
}

function formatValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number")  return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date)      return `'${v.toISOString()}'`;
  if (typeof v === "object")  return `PARSE_JSON('${JSON.stringify(v).replaceAll("'", "''")}')`;
  return `'${String(v).replaceAll("'", "''")}'`;
}
