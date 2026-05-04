-- 0003_auctions.sql
-- Auction definitions, bids, and settlement records (live tier).

CREATE TABLE IF NOT EXISTS auctions (
  auction_id        TEXT PRIMARY KEY,
  lot_id            TEXT NOT NULL,
  type              TEXT NOT NULL,        -- 'live' | 'sealed' | 'dutch'
  starting_price    REAL,
  reserve_price     REAL,
  starts_at         TEXT NOT NULL,
  ends_at           TEXT NOT NULL,
  soft_close_secs   INTEGER DEFAULT 60,
  status            TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|live|closed|cancelled|settled
  winning_bid_id    TEXT,
  winning_buyer_id  TEXT,
  winning_price     REAL,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auctions_status   ON auctions(status);
CREATE INDEX IF NOT EXISTS idx_auctions_endtime  ON auctions(ends_at);

-- platform_bids: live auction bids for the unified platform.
-- Distinct from existing 'bids' table which holds legacy lot offers.
CREATE TABLE IF NOT EXISTS platform_bids (
  bid_id        TEXT PRIMARY KEY,
  auction_id    TEXT NOT NULL,
  buyer_id      TEXT NOT NULL,
  buyer_tier    TEXT,                      -- tier1|tier2|tier3
  price         REAL NOT NULL,
  quantity_kg   REAL,
  placed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  source        TEXT DEFAULT 'web',        -- web|api|mobile
  rejected      INTEGER DEFAULT 0,
  rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_bids_auction ON platform_bids(auction_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_bids_buyer   ON platform_bids(buyer_id);

CREATE TABLE IF NOT EXISTS settlements (
  settlement_id  TEXT PRIMARY KEY,
  auction_id     TEXT NOT NULL,
  lot_id         TEXT NOT NULL,
  gross          REAL,
  platform_fee   REAL,
  nation_share   REAL,
  harvester_net  REAL,
  currency       TEXT DEFAULT 'CAD',
  status         TEXT NOT NULL DEFAULT 'pending', -- pending|paid|reversed
  paid_at        TEXT,
  stripe_pi_id   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
