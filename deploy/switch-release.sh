#!/usr/bin/env bash
# Switches production to a verified candidate build. Run on the VM:
#   bash ~/dealio-candidate-<sha>/switch-release.sh <sha>
# ~/dealio-candidate-<sha>/ must hold dist-<sha>.tar.gz, manifest-<sha>.json and
# extracted/dist (see deploy/README.tr.md). The build must come from origin/main
# itself: its tree has to match the manifest's sourceTree, or nothing changes.
set -euo pipefail
SHA=${1:?usage: switch-release.sh <short-sha>}
APP=~/steam-wishlist-discord-bot
CAND=~/dealio-candidate-$SHA
MANIFEST=$CAND/manifest-$SHA.json
B=~/dealio-backups/$(date -u +%Y%m%d)-$SHA
field() { grep -o "\"$1\": \"[0-9a-f]*\"" "$MANIFEST" | cut -d'"' -f4; }
TREE=$(field sourceTree)
test -n "$TREE" || { echo "manifest has no sourceTree"; exit 1; }

cd "$APP"
git fetch -q origin
test "$(git rev-parse 'origin/main^{tree}')" = "$TREE" || { echo "origin/main tree differs from the built tree"; exit 1; }
git merge-base --is-ancestor HEAD origin/main || { echo "origin/main is not a fast-forward"; exit 1; }
test -z "$(git status --porcelain)" || { echo "dirty tree"; exit 1; }
test "$(sha256sum "$CAND/dist-$SHA.tar.gz" | cut -d' ' -f1)" = "$(field distArchiveSha256)" || { echo "archive checksum mismatch"; exit 1; }
PREV=$(git rev-parse HEAD)
mkdir -p "$B" && chmod 700 "$B"
cp "$MANIFEST" "$B/manifest.json"
echo "$PREV" > "$B/previous-commit"

rollback() {
  echo "!! failure, restoring previous build"
  if [ -d "$B/dist" ]; then rm -rf "$APP/dist"; cp -a "$B/dist" "$APP/dist"; fi
  git -C "$APP" reset -q --hard "$PREV"
  sudo systemctl start dealio
}
trap rollback ERR

sudo systemctl stop dealio
cp -p data/wishlist.db "$B/wishlist.db"
for f in data/wishlist.db-wal data/wishlist.db-shm; do [ -f "$f" ] && cp -p "$f" "$B/" || true; done
cp "$B/wishlist.db" "$B/restore-test.db"
node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
const ok = db.prepare("PRAGMA integrity_check").get();
const fk = db.prepare("PRAGMA foreign_key_check").all().length;
const users = db.prepare("SELECT COUNT(*) AS n FROM user_config").get().n;
console.log("integrity", JSON.stringify(ok), "fkViolations", fk, "users", users);
if (Object.values(ok)[0] !== "ok" || fk !== 0) process.exit(1);
' "$B/restore-test.db" 2>&1 | grep -v ExperimentalWarning
test "${PIPESTATUS[0]}" -eq 0
rm "$B/restore-test.db"

git merge -q --ff-only origin/main
mv dist "$B/dist"
cp -a "$CAND/extracted/dist" dist
diff -r dist "$CAND/extracted/dist" && echo "dist matches candidate"
sudo systemctl start dealio
trap - ERR
echo "HEAD now $(git log --oneline -1); backup in $B"
