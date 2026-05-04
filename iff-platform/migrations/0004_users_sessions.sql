-- 0004_users_sessions.sql
-- User profiles, role assignments, sessions, notification logs.

CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,        -- Clerk user id or generated UUID
  email          TEXT UNIQUE,
  display_name   TEXT,
  primary_role   TEXT NOT NULL,           -- iff_admin|iff_operator|nation_admin|harvester|buyer_tier1|buyer_tier2|buyer_tier3|consumer|chef|grocer|viewer|investor
  nation         TEXT,
  organization   TEXT,
  metadata       TEXT,                    -- JSON
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_role   ON users(primary_role);
CREATE INDEX IF NOT EXISTS idx_users_nation ON users(nation);

CREATE TABLE IF NOT EXISTS user_roles_extra (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL,
  scope       TEXT,                       -- e.g. nation_id, vessel_id
  granted_by  TEXT,
  granted_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, role, scope)
);

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash     TEXT PRIMARY KEY,           -- sha256 of api key
  user_id      TEXT NOT NULL,
  label        TEXT,
  scopes       TEXT,                       -- JSON array
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,
  revoked_at   TEXT,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  body        TEXT,
  severity    TEXT,                        -- info|warn|critical
  meta        TEXT,                        -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  kind        TEXT,
  lot_id      TEXT,
  read        INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_notif_user ON user_notifications(user_id, read, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id     TEXT,
  action       TEXT NOT NULL,
  target_kind  TEXT,
  target_id    TEXT,
  payload      TEXT,
  ip           TEXT,
  occurred_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, occurred_at);
