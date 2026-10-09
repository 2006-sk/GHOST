#!/usr/bin/env bash
# deploy.sh — publish all six GHOST personas to the Guild workspace.
#
# Each persona is its own Guild agent (agent-1..6, master.md §4.1). The Guild
# CLI operates on an agent *project* (scaffolded by `guild agent init`), so the
# exact layout — six sibling agent projects vs. one project with six
# entrypoints — should be confirmed against your `guild agent init` output.
# The commands below assume one agent project per persona living under
# ./agents/<persona>/ with the entrypoint copied/symlinked in. Adjust to match
# whatever `guild agent init` actually scaffolds in your workspace.
#
# Prereqs:
#   - guild CLI installed and authenticated (see docs.guild.ai/cli/getting-started)
#   - GUILD_WORKSPACE set to your workspace id or full name (owner~workspace-name)
set -euo pipefail

: "${GUILD_WORKSPACE:?set GUILD_WORKSPACE to your workspace id (owner~workspace-name)}"

PERSONAS=(recon netscan injection auth_bypass dos logic_abuse)

for persona in "${PERSONAS[@]}"; do
  echo "== publishing ghost-${persona} =="
  # From within this persona's agent project directory:
  #   guild agent save --message "ghost ${persona} (mock)" --publish --workspace "$GUILD_WORKSPACE"
  guild agent save \
    --message "ghost ${persona} (mock)" \
    --publish \
    --workspace "$GUILD_WORKSPACE"
done

echo "done. verify in the Guild sessions dashboard (screenshot for submission)."
