#!/usr/bin/env bash
# Runs the full CI on a branch that is already pushed to origin, waits and prints the result and the
# artifact commands. The logic is in scripts/lib/ci-branch.ts; usage: ci-branch.sh <branch> [--only screenshots]
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun run scripts/ci-branch.ts "$@"
