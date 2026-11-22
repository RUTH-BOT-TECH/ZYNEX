#!/usr/bin/env bash
# Verifies no traces of the upstream bot remain in our copy.
# LICENSE and bun.lock are excluded by design (attribution must stay).
set -uo pipefail
cd "$(dirname "$0")/.."
PATTERN='yobby|meg ?queen|megqueen|megh|xtechkin|boboh|254795314221'
HITS=$(grep -rniI -E "$PATTERN" \
  --exclude-dir=node_modules --exclude-dir=auth_state \
  --exclude=LICENSE --exclude=bun.lock --exclude=package-lock.json --exclude=brand-check.sh --exclude=README-ZYNEX.md . 2>/dev/null)
if [ -z "$HITS" ]; then
  echo "✓ clean — no upstream branding found"
else
  echo "✗ found leftovers:"
  echo "$HITS"
  exit 1
fi
