// Lightweight request logger — Tail+Logpush will forward these.

export default async function logger(c, next) {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const u = c.get("user");
  console.log(JSON.stringify({
    t: new Date().toISOString(),
    m: c.req.method,
    p: new URL(c.req.url).pathname,
    s: c.res.status,
    ms,
    u: u?.sub || null,
    r: u?.role || null,
  }));
}
