#!/usr/bin/env bash
# scan.sh — run Semgrep over the attacky/ target with GHOST-tuned + registry rules.
# Usage: bash data/semgrep/scan.sh [target_dir]   (default: attacky)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$HERE/../../attacky}"
SEMGREP="$(command -v semgrep || echo "$HOME/.local/bin/semgrep")"

"$SEMGREP" scan \
  --config "$HERE/ghost-rules.yml" \
  --config p/javascript --config p/owasp-top-ten --config p/secrets \
  --metrics=off \
  "$TARGET"
