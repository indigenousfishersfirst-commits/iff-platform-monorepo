-- 0001_signals_cache.sql
-- D1 cache of OPS.SIGNALS_FEED for low-latency reads from frontends.
-- Refreshed by snowflake-sync.js every 5 minutes.

CREATE TABLE IF NOT EXISTS signals_cache (
  signal_id      TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  species        TEXT,
  value          REAL,
  unit           TEXT,
  confidence     REAL,
  direction      TEXT,
  envelope       TEXT,                  -- full JSON envelope
  computed_at    TEXT NOT NULL,
  cached_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_signals_kind     ON signals_cache(kind);
CREATE INDEX IF NOT EXISTS idx_signals_species  ON signals_cache(species);
CREATE INDEX IF NOT EXISTS idx_signals_computed ON signals_cache(computed_at);

CREATE TABLE IF NOT EXISTS signals_history (
  history_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id      TEXT NOT NULL,
  value          REAL,
  confidence     REAL,
  direction      TEXT,
  computed_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_signal_time
  ON signals_history(signal_id, computed_at DESC);
