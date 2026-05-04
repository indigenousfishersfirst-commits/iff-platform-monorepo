// KV-backed token bucket — 60 req/min per user (or IP for unauth).

const WINDOW_SEC = 60;
const LIMIT      = 60;

export default async function rateLimit(c, next) {
  const user = c.get("user");
  const key  = user
    ? `rl:u:${user.sub}`
    : `rl:ip:${c.req.header("cf-connecting-ip") || "anon"}`;
  const now  = Math.floor(Date.now() / 1000);
  const slot = Math.floor(now / WINDOW_SEC);
  const cell = `${key}:${slot}`;
  const cur  = parseInt((await c.env.IFF_KV.get(cell)) || "0", 10);
  if (cur >= LIMIT) {
    c.header("retry-after", String(WINDOW_SEC - (now % WINDOW_SEC)));
    return c.json({ error: "rate_limited" }, 429);
  }
  await c.env.IFF_KV.put(cell, String(cur + 1), { expirationTtl: WINDOW_SEC * 2 });
  return next();
}
