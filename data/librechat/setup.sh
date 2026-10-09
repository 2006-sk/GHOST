#!/usr/bin/env bash
# Generate data/librechat/.env (gitignored) from the repo-root .env + fresh random secrets.
# Usage: ./setup.sh            (re-running keeps existing secrets)
set -euo pipefail
cd "$(dirname "$0")"
ROOT_ENV=../../.env
[ -f .env ] && { echo ".env already exists; delete it to regenerate"; exit 0; }
get() { grep -E "^$1=" "$ROOT_ENV" | head -1 | cut -d= -f2-; }
rand() { python -c "import secrets;print(secrets.token_hex($1))"; }

CH_URL=$(get CLICKHOUSE_URL)
CH_HOST=$(echo "$CH_URL" | sed -E 's#^https?://##; s#:[0-9]+/?$##; s#/$##')

cat > .env <<EOF
# --- ClickHouse MCP (read-only user) ---
CLICKHOUSE_HOST=$CH_HOST
CLICKHOUSE_RO_USER=$(get CLICKHOUSE_RO_USER)
CLICKHOUSE_RO_PASSWORD=$(get CLICKHOUSE_RO_PASSWORD)
CLICKHOUSE_MCP_AUTH_TOKEN=$(rand 32)

# --- LibreChat ---
DOMAIN_CLIENT=http://localhost:3080
DOMAIN_SERVER=http://localhost:3080
CREDS_KEY=$(rand 32)
CREDS_IV=$(rand 16)
JWT_SECRET=$(rand 32)
JWT_REFRESH_SECRET=$(rand 32)
MEILI_MASTER_KEY=$(rand 32)
SEARCH=true
ALLOW_REGISTRATION=true
ALLOW_EMAIL_LOGIN=true
# "user_provided" = paste your key in the LibreChat UI; or put a real key here.
ANTHROPIC_API_KEY=user_provided
ENDPOINTS=anthropic,agents
EOF
echo "wrote data/librechat/.env"
