-- GHOST — ClickHouse schema.
-- Columns mirror the row the coordinator inserts (backend/src/ingest.js) so
-- `INSERT INTO ghost.events FORMAT JSONEachRow` works with no client changes.
-- Optional fields arrive as JSON null and fall back to the column default.

CREATE DATABASE IF NOT EXISTS ghost;

CREATE TABLE IF NOT EXISTS ghost.events
(
    run_id            String,
    seq               UInt64,
    ts                DateTime64(3, 'UTC'),
    event_type        LowCardinality(String),
    agent_id          LowCardinality(String),
    agent_persona     LowCardinality(String),
    target_component  String                 DEFAULT '',
    severity          LowCardinality(String) DEFAULT '',
    description       String                 DEFAULT '',
    payload           String                 DEFAULT '',
    http_status       UInt16                 DEFAULT 0,
    evidence          String                 DEFAULT '',
    src_ip            String                 DEFAULT '',
    health_delta      Int16                  DEFAULT 0,
    tower_health      UInt8                  DEFAULT 100,
    -- detection verdict (inline in mock mode, from the rules at scale)
    detected          Bool                   DEFAULT false,
    rule              LowCardinality(String) DEFAULT '',
    detect_latency_ms UInt32                 DEFAULT 0,
    confidence        Float32                DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY run_id
ORDER BY (run_id, agent_persona, ts, seq);
