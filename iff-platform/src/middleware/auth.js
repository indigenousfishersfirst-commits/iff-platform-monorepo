// Clerk JWT verification + role gate.
// Falls back to API-key auth (KV-stored) for service-to-service calls
// (Streamlit → Worker, Snowflake stored procedures → Worker).

import { jwtVerify, importSPKI } from "jose";

export default async function auth(c, next) {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/public") || path === "/healthz") return next();

  const authz = c.req.header("authorization") || "";

  // ---------- Service API key (Snowflake → Worker, Streamlit → Worker) -
  if (authz.startsWith("ApiKey ")) {
    const key = authz.slice(7);
    const meta = await c.env.IFF_KV.get(`apikey:${key}`, "json");
    if (!meta) return c.json({ error: "invalid_api_key" }, 401);
    c.set("user", { sub: meta.owner, role: meta.role || "iff_operator", source: "apikey" });
    return next();
  }

  // ---------- Clerk JWT --------------------------------------------------
  if (!authz.startsWith("Bearer "))
    return c.json({ error: "missing_auth" }, 401);
  const token = authz.slice(7);

  try {
    const pubKey = await importSPKI(c.env.CLERK_JWT_PUBLIC_KEY, "RS256");
    const { payload } = await jwtVerify(token, pubKey, {
      issuer: c.env.CLERK_ISSUER,
    });
    c.set("user", {
      sub: payload.sub,
      email: payload.email,
      role: payload.public_metadata?.role || "viewer",
      nation_id: payload.public_metadata?.nation_id || null,
      source: "clerk",
    });
    return next();
  } catch (err) {
    return c.json({ error: "invalid_token", detail: err.message }, 401);
  }
}

// Helper for individual routes that need a stricter role
export function requireRole(...roles) {
  return async (c, next) => {
    const u = c.get("user");
    if (!u || !roles.includes(u.role))
      return c.json({ error: "forbidden", required: roles, have: u?.role }, 403);
    return next();
  };
}
