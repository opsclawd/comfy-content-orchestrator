#!/usr/bin/env bash
set -euo pipefail

echo "=== Git Status ==="
git status --porcelain
echo "=== Git Show Head ==="
git show --stat --oneline HEAD
echo "=== Run web tests and typecheck ==="
pnpm vitest run apps/web/src/api/runtime-config.test.ts apps/web/src/api/client.test.ts
pnpm --filter web typecheck
