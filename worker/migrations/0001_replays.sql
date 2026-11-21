-- Shared replays (ARCHITECTURE-M2 §12.1). `data` is the opaque deflate-raw blob the client sent, validated before
-- insert; no IP, user agent or client id is stored. Expiry is enforced on read and purged on write (no cron).
CREATE TABLE IF NOT EXISTS replays (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  sim_version TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  suspension TEXT NOT NULL,
  seconds REAL NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS replays_expires ON replays (expires_at);
