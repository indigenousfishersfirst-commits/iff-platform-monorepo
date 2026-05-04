-- 0002_lots_cache.sql
-- D1 cache of MARKETPLACE.LOTS for fast harvester / auction reads.

CREATE TABLE IF NOT EXISTS lots_cache (
  lot_id           TEXT PRIMARY KEY,
  species          TEXT NOT NULL,
  gear             TEXT,
  area             TEXT,
  harvested_at     TEXT,
  weight_kg        REAL,
  grade            TEXT,
  nation           TEXT,
  vessel_name      TEXT,
  status           TEXT,                -- listed | in_auction | sold | shipped | settled
  listing_price    REAL,
  destination      TEXT,
  envelope         TEXT,                -- full JSON
  cached_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lots_status   ON lots_cache(status);
CREATE INDEX IF NOT EXISTS idx_lots_species  ON lots_cache(species);
CREATE INDEX IF NOT EXISTS idx_lots_nation   ON lots_cache(nation);

CREATE TABLE IF NOT EXISTS lot_events_cache (
  event_id     TEXT PRIMARY KEY,
  lot_id       TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  actor_id     TEXT,
  actor_role   TEXT,
  occurred_at  TEXT NOT NULL,
  payload      TEXT,
  prev_hash    TEXT,
  event_hash   TEXT,
  cached_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lot_events_lot ON lot_events_cache(lot_id, occurred_at);
