#!/usr/bin/env bash
# Redeploys the backend to a VPS that runs it natively under pm2 (no Docker).
#
#   deploy/deploy-native.sh ubuntu@162.62.231.147
#
# Ships a clean `git archive` of HEAD (never the working tree, so .secrets and .env files stay
# local), builds on the server, swaps the bundle in and restarts the pm2 process. The server keeps
# its own ~/chog-world/backend.env; see deploy/README.md for the one-time setup.
set -euo pipefail

TARGET="${1:?usage: deploy/deploy-native.sh <user@host>}"
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
ARCHIVE="$(mktemp -t chogworld-src).tgz"
trap 'rm -f "$ARCHIVE"' EXIT

if [ -n "$(git -C "$ROOT" status --porcelain -- apps/backend packages/shared pnpm-lock.yaml)" ]; then
  echo "Uncommitted backend changes: commit them first, only HEAD is deployed." >&2
  exit 1
fi

git -C "$ROOT" archive --format=tar.gz -o "$ARCHIVE" HEAD
scp -q "$ARCHIVE" "$TARGET:/tmp/chogworld-src.tgz"

ssh "$TARGET" 'bash -s' <<'REMOTE'
set -euo pipefail
cd ~/chog-world
rm -rf src && mkdir src && tar xzf /tmp/chogworld-src.tgz -C src && rm /tmp/chogworld-src.tgz
cd src
P="corepack pnpm@10.30.1"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
$P install --frozen-lockfile --filter @chog-world/backend... >/dev/null
$P --filter @chog-world/shared build >/dev/null
$P --filter @chog-world/backend build >/dev/null
rm -rf ../app.new
$P --filter @chog-world/backend deploy --prod --legacy ../app.new >/dev/null
cd ..
rm -rf app.old
[ -d app ] && mv app app.old
mv app.new app
pm2 restart chogworld-backend >/dev/null
rm -rf app.old
for _ in $(seq 1 30); do
  if curl -fs 127.0.0.1:9100/health; then echo; exit 0; fi
  sleep 2
done
echo "backend did not become healthy; check: pm2 logs chogworld-backend" >&2
exit 1
REMOTE
