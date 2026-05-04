// =====================================================================
// iff-platform — single Worker gateway for everything.
// Domain: api.cantekhi.com
//
// Responsibilities:
//   • REST API for all 5 frontends + 3 internal surfaces
//   • Cron-driven ingestion of 92+ data sources
//   • Queue consumer (signal recompute, settlement, sync, notifications)
//   • Durable Object for live auction rooms
//   • Bidirectional Snowflake ↔ D1 sync
//   • Perplexity bridge for research / variable discovery
// =====================================================================

import { Hono } from "hono";
import { cors } from "hono/cors";

import auth      from "./middleware/auth.js";
import logger    from "./middleware/logger.js";
import rateLimit from "./middleware/rate-limit.js";

import signalsRoutes      from "./routes/signals.js";
import lotsRoutes         from "./routes/lots.js";
import auctionsRoutes     from "./routes/auctions.js";
import traceabilityRoutes from "./routes/traceability.js";
import settlementsRoutes  from "./routes/settlements.js";
import researchRoutes     from "./routes/research.js";
import publicRoutes       from "./routes/public.js";

import { runScheduled } from "./lib/scheduler.js";
import { handleQueue }  from "./lib/queue.js";

export { AuctionRoom } from "./durable-objects/auction-room.js";

const app = new Hono();

// ---------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------
app.use("*", logger);
app.use(
  "*",
  cors({
    origin: [
      "https://app.cantekhi.com",
      "https://auction.cantekhi.com",
      "https://chef.cantekhi.com",
      "https://market.cantekhi.com",
      "https://shop.cantekhi.com",
      "https://iff-app-git.pages.dev",
      "https://iff-app-2mw.pages.dev",
    ],
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use("/v1/*", rateLimit);
app.use("/v1/*", auth); // public routes mounted before /v1/*

// ---------------------------------------------------------------------
// Public routes (no auth) — QR landing, healthz, status
// ---------------------------------------------------------------------
app.route("/public", publicRoutes);
app.get("/healthz", (c) => c.json({ ok: true, ts: Date.now() }));

// ---------------------------------------------------------------------
// Authenticated v1 API
// ---------------------------------------------------------------------
app.route("/v1/signals",      signalsRoutes);
app.route("/v1/lots",         lotsRoutes);
app.route("/v1/auctions",     auctionsRoutes);
app.route("/v1/traceability", traceabilityRoutes);
app.route("/v1/settlements",  settlementsRoutes);
app.route("/v1/research",     researchRoutes);

// ---------------------------------------------------------------------
// WebSocket → Durable Object (live auction)
// ---------------------------------------------------------------------
app.get("/ws/auction/:id", async (c) => {
  const upgrade = c.req.header("Upgrade");
  if (upgrade !== "websocket") return c.text("expected websocket", 426);
  const id  = c.env.AUCTION_ROOM.idFromName(c.req.param("id"));
  const obj = c.env.AUCTION_ROOM.get(id);
  return obj.fetch(c.req.raw);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error("unhandled", err);
  return c.json({ error: "internal_error", message: err.message }, 500);
});

// ---------------------------------------------------------------------
// Cron + Queue
// ---------------------------------------------------------------------
export default {
  fetch:     app.fetch,
  scheduled: runScheduled,    // dispatched in lib/scheduler.js by cron expr
  queue:     handleQueue,     // dispatched in lib/queue.js by message type
};
