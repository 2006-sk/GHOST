-- GHOST — small mutable state (master.md / aditya.md §4).
-- Append-only telemetry lives in ClickHouse; the few rows we UPDATE live here.
-- Works on PGlite (embedded, default) and any real Postgres (POSTGRES_URL).

CREATE TABLE IF NOT EXISTS runs (
  run_id          TEXT PRIMARY KEY,
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  mode            TEXT,
  final_coverage  NUMERIC
);

CREATE TABLE IF NOT EXISTS agents (
  run_id      TEXT,
  agent_id    TEXT,
  persona     TEXT,
  state       TEXT,
  updated_at  TIMESTAMPTZ,
  PRIMARY KEY (run_id, agent_id)
);

CREATE TABLE IF NOT EXISTS targets (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  sandbox_id  TEXT,
  status      TEXT
);

CREATE TABLE IF NOT EXISTS rules (
  id        TEXT PRIMARY KEY,
  descr     TEXT,
  threshold INT,
  enabled   BOOLEAN DEFAULT TRUE
);
