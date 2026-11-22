#!/usr/bin/env bash
# Verifies no traces of the upstream bot remain in our copy.
# Nothing is exempt now: bun.lock was deleted (every deploy target uses npm) and it
# was the last file carrying the old package name. LICENSE included in the sweep.
set -uo pipefail
cd "$(dirname "$0")/.."
PATTERN='yobby|meg ?queen|megqueen|megh|xtechkin|boboh|254795314221'
# samples/ holds generated proof artifacts (PNGs embedded as base64). Random
# base64 will eventually spell "megh" or "boboh" by chance, so those are skipped
# here and re-checked below with the payloads stripped.
HITS=$(grep -rniI -E "$PATTERN" \
  --exclude-dir=node_modules --exclude-dir=auth_state --exclude-dir=samples --exclude-dir=.git \
  --exclude=package-lock.json --exclude=brand-check.sh --exclude=README-ZYNEX.md . 2>/dev/null)
# Re-scan samples/ with base64 payloads removed, so we still catch a real
# string sneaking into the surrounding markup.
SAMPLE_HITS=$(for f in $(find samples -type f -name '*.html' 2>/dev/null); do
  sed -E 's/base64,[A-Za-z0-9+\/=]+/base64,<stripped>/g' "$f" | grep -niE "$PATTERN" | sed "s|^|$f:|"
done)

if [ -z "$HITS" ] && [ -z "$SAMPLE_HITS" ]; then
  echo "✓ clean — no upstream branding found"
else
  echo "✗ found leftovers:"
  echo "$HITS"
  echo "$SAMPLE_HITS"
  exit 1
fi
