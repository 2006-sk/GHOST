#!/usr/bin/env bash
# guild-live.sh — run all six GHOST agents as REAL Guild cloud sessions, so they
# show up as activity on the Guild dashboard (app.guild.ai).
#
# Prereqs: `guild auth login` done once (browser). The ghost-* agents published.
# Usage:   bash backend/scripts/guild-live.sh [workspace-name]
set -euo pipefail

WS_NAME="${1:-ghost-siege}"
OWNER="$(guild api GET /me | python3 -c 'import sys,json;print(json.load(sys.stdin).get("name",""))')"
# resolve (or create) the workspace id
WS=$(guild api GET "/workspaces/$OWNER~$WS_NAME" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)
if [ -z "$WS" ]; then
  WS=$(guild workspace create "$WS_NAME" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')
fi
RUN="run_guildlive_$(date +%H%M%S)"
echo "owner=$OWNER workspace=$WS_NAME ($WS) run=$RUN"

for pair in recon:ghost-recon netscan:ghost-netscan injection:ghost-injection \
            auth_bypass:ghost-auth-bypass dos:ghost-dos logic_abuse:ghost-logic-abuse; do
  persona="${pair%%:*}"; agent="${pair##*:}"
  avid=$(guild api GET "/agents/$OWNER~$agent" | python3 -c 'import sys,json;print((json.load(sys.stdin).get("latest_published_version") or {}).get("id",""))')
  [ -z "$avid" ] && { echo "  $agent: no published version"; continue; }
  sid=$(guild api POST "/workspaces/$WS/sessions" --data "{\"session_type\":\"agent_test\",\"agent_version_id\":\"$avid\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')
  [ -z "$sid" ] && { echo "  $agent: session create failed"; continue; }
  input="{\"run_id\":\"$RUN\",\"mode\":\"mock\",\"agent_persona\":\"$persona\",\"target\":{\"base_url\":\"http://localhost:4000/\",\"tool\":\"target_http\"},\"emit_url\":\"http://localhost:8080/events\",\"shared_memory_ref\":\"$RUN/memory\",\"intensity\":\"demo\"}"
  guild session send "$sid" --json="$input" >/dev/null 2>&1
  echo "  $agent → https://app.guild.ai/sessions/$sid ✓"
done
echo "done — 6 Guild sessions running. Refresh app.guild.ai (workspace: $WS_NAME)."
