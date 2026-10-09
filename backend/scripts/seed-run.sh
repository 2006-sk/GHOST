#!/usr/bin/env bash
# seed-run.sh — create a run_id and kick a demo siege against a running coordinator.
# Usage: bash scripts/seed-run.sh [base_url]
set -euo pipefail

BASE="${1:-http://localhost:8080}"
RUN_ID="run_$(date +%Y%m%d)_$(printf '%02d' $((RANDOM % 100)))"

echo "coordinator: $BASE"
echo "run_id:      $RUN_ID"

echo "→ prepare"
curl -fsS -X POST "$BASE/api/prepare" -H 'Content-Type: application/json' \
  -d '{"folder":"TowerBank"}' && echo

echo "→ reset"
curl -fsS "$BASE/reset" && echo

echo "→ run (starts the siege)"
curl -fsS -X POST "$BASE/api/run" -H 'Content-Type: application/json' \
  -d "{\"run_id\":\"$RUN_ID\"}" && echo

sleep 2
echo "→ money shot: trigger critical"
curl -fsS "$BASE/trigger/critical" && echo

echo "→ state"
curl -fsS "$BASE/state" && echo
echo
echo "Watch the siege at the frontend (VITE_WS_URL=ws://localhost:8080/ws)."
echo "Stop the loop: curl -X POST $BASE/api/stop"
