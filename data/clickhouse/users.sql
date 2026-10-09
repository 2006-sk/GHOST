-- Read-only user for LibreChat's ClickHouse MCP (already created on our Cloud service).
-- readonly = 2: SELECT only, but session settings may change (the MCP server sets some).
-- Replace <password>, then put it in the repo-root .env as CLICKHOUSE_RO_PASSWORD.
CREATE USER IF NOT EXISTS librechat_ro IDENTIFIED WITH sha256_password BY '<password>' SETTINGS readonly = 2;
GRANT SELECT ON ghost.* TO librechat_ro;
