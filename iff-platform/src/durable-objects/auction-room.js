// AuctionRoom Durable Object
// One instance per auction. Holds current price, soft-close timer, broadcasts
// every bid to connected WebSocket clients, persists to Snowflake at close.

import { Snowflake } from "../lib/snowflake.js";

export class AuctionRoom {
  constructor(state, env) {
    this.state = state;
    this.env   = env;
    this.sockets = new Set();
    this.meta = null;            // { auction_id, lot_id, type, current, reserve, closes_at, ... }
    this.state.blockConcurrencyWhile(async () => {
      this.meta = (await state.storage.get("meta")) || null;
    });
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/init" && req.method === "POST") {
      this.meta = await req.json();
      this.meta.bid_count = 0;
      this.meta.high_bidder = null;
      this.meta.status = "OPEN";
      await this.state.storage.put("meta", this.meta);
      this.scheduleClose();
      return Response.json({ ok: true });
    }

    if (req.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.sockets.add(server);
      server.send(JSON.stringify({ type: "snapshot", meta: this.meta }));
      server.addEventListener("message", (e) => this.onMessage(server, e.data));
      server.addEventListener("close", () => this.sockets.delete(server));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  async onMessage(socket, data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!this.meta || this.meta.status !== "OPEN") return;
    if (msg.type !== "bid") return;

    const { buyer_id, price } = msg;
    if (typeof price !== "number" || price <= this.meta.current_price) {
      socket.send(JSON.stringify({ type: "bid_rejected", reason: "below_current" }));
      return;
    }

    this.meta.current_price = price;
    this.meta.high_bidder   = buyer_id;
    this.meta.bid_count    += 1;

    // Soft-close: if within extend window, push closes_at out
    const remaining = new Date(this.meta.closes_at).getTime() - Date.now();
    if (remaining < (this.meta.extend_on_bid_secs ?? 60) * 1000) {
      this.meta.closes_at = new Date(
        Date.now() + (this.meta.extend_on_bid_secs ?? 60) * 1000,
      ).toISOString();
      this.meta.status = "EXTENDED";
    }
    await this.state.storage.put("meta", this.meta);

    // Persist bid to Snowflake (fire-and-forget)
    this.persistBid(buyer_id, price).catch(console.error);

    // Broadcast
    const payload = JSON.stringify({
      type: "bid",
      auction_id: this.meta.auction_id,
      price,
      buyer_id,
      bid_count: this.meta.bid_count,
      closes_at: this.meta.closes_at,
    });
    for (const s of this.sockets) try { s.send(payload); } catch {}
    this.scheduleClose();
  }

  scheduleClose() {
    const delay = new Date(this.meta.closes_at).getTime() - Date.now();
    if (delay <= 0) return this.closeAuction();
    this.state.storage.setAlarm(Date.now() + delay);
  }

  async alarm() { return this.closeAuction(); }

  async closeAuction() {
    if (!this.meta || this.meta.status === "CLOSED") return;
    this.meta.status = "CLOSED";
    this.meta.closed_at = new Date().toISOString();
    await this.state.storage.put("meta", this.meta);

    const sf = new Snowflake(this.env);
    await sf.exec(`
      UPDATE MARKETPLACE.AUCTIONS
      SET STATUS = 'AWARDED', CURRENT_PRICE = ${this.meta.current_price},
          BID_COUNT = ${this.meta.bid_count}, HIGH_BIDDER_ID = '${this.meta.high_bidder || ""}',
          AWARDED_AT = CURRENT_TIMESTAMP(), SETTLEMENT_PRICE = ${this.meta.current_price}
      WHERE AUCTION_ID = '${this.meta.auction_id}'
    `, { schema: "MARKETPLACE" });

    await this.env.IFF_JOBS.send({
      type: "settlement.run",
      payload: { auction_id: this.meta.auction_id },
    });

    const close = JSON.stringify({ type: "closed", final: this.meta });
    for (const s of this.sockets) try { s.send(close); s.close(); } catch {}
  }

  async persistBid(buyer_id, price) {
    const sf = new Snowflake(this.env);
    await sf.exec(`
      INSERT INTO MARKETPLACE.BIDS
      (BID_ID, AUCTION_ID, BUYER_ID, BID_PRICE, BID_TIME, BID_TYPE, STATUS, SOURCE)
      SELECT UUID_STRING(), '${this.meta.auction_id}', '${buyer_id}',
             ${price}, CURRENT_TIMESTAMP(), 'LIVE', 'WINNING', 'WS'
    `, { schema: "MARKETPLACE" });
  }
}
