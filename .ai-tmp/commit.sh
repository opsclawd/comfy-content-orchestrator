#!/usr/bin/env bash
set -euo pipefail

PRE_HEAD=$(git rev-parse HEAD)
git add apps/web/src/api/runtime-config.ts apps/web/src/api/runtime-config.test.ts apps/web/src/api/client.ts apps/web/next.config.ts

git commit -F - <<'COMMIT_MESSAGE'
feat(web): require production control API configuration
COMMIT_MESSAGE

[ "$(git rev-parse HEAD)" != "$PRE_HEAD" ] || { echo "COMMIT DID NOT ADVANCE"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "WORKTREE DIRTY AFTER COMMIT"; exit 1; }
echo "COMMIT SUCCESSFUL: $(git rev-parse HEAD)"
