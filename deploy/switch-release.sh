#!/usr/bin/env bash
# Switches production to a verified candidate build. Run on the VM:
#   bash ~/dealio-candidate-<sha>/switch-release.sh <sha>
# ~/dealio-candidate-<sha>/ must hold dist-<sha>.tar.gz and manifest-<sha>.json
# (see deploy/README.tr.md). The build must come from origin/main itself: its
# tree has to match the manifest's sourceTree, or nothing changes. What goes live
# is a fresh extraction of the checksummed archive, never a directory that was
# extracted earlier by hand.
#
# After the start the script waits for the new process to report Discord ready
# in .runtime/bot.health.json; if it does not, the previous commit, dist and (when
# the schema version moved) database come back and the old build starts again.
# If package-lock.json changes, prepare production dependencies first and set
# DEALIO_DEPENDENCIES_READY=1.
set -euo pipefail
SHA=${1:?usage: switch-release.sh <short-sha>}
[[ $SHA =~ ^[0-9a-f]{7,40}$ ]] || { echo "not a commit sha: $SHA"; exit 1; }
APP=~/steam-wishlist-discord-bot
CAND=~/dealio-candidate-$SHA
MANIFEST=$CAND/manifest-$SHA.json
ARCHIVE=$CAND/dist-$SHA.tar.gz
B=~/dealio-backups/$(date -u +%Y%m%d)-$SHA
HEALTH_TIMEOUT=${DEALIO_SWITCH_HEALTH_TIMEOUT:-180}
[[ $HEALTH_TIMEOUT =~ ^[0-9]+$ ]] || { echo "DEALIO_SWITCH_HEALTH_TIMEOUT must be whole seconds"; exit 1; }
field() { grep -o "\"$1\": \"[0-9a-f]*\"" "$MANIFEST" | cut -d'"' -f4; }
schema_version() {
  node -e 'const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1], { readOnly: true });
console.log(db.prepare("PRAGMA user_version").get().user_version);' "$1" 2>/dev/null
}
TREE=$(field sourceTree)
test -n "$TREE" || { echo "manifest has no sourceTree"; exit 1; }

cd "$APP"
git fetch -q origin
test "$(git rev-parse 'origin/main^{tree}')" = "$TREE" || { echo "origin/main tree differs from the built tree"; exit 1; }
git merge-base --is-ancestor HEAD origin/main || { echo "origin/main is not a fast-forward"; exit 1; }
test -z "$(git status --porcelain)" || { echo "dirty tree"; exit 1; }
if ! git diff --quiet HEAD origin/main -- package-lock.json && [ "${DEALIO_DEPENDENCIES_READY:-}" != 1 ]; then
  echo "package-lock.json changes; install the verified production dependencies, then rerun with DEALIO_DEPENDENCIES_READY=1"
  exit 1
fi
test "$(sha256sum "$ARCHIVE" | cut -d' ' -f1)" = "$(field distArchiveSha256)" || { echo "archive checksum mismatch"; exit 1; }
VERIFIED=$(mktemp -d "$CAND/verified.XXXXXX")
tar -xzf "$ARCHIVE" -C "$VERIFIED"
test -f "$VERIFIED/dist/index.js" || { echo "archive has no dist/index.js"; exit 1; }
PREV=$(git rev-parse HEAD)
mkdir -p "$B" && chmod 700 "$B"
cp "$MANIFEST" "$B/manifest.json"
echo "$PREV" > "$B/previous-commit"

STARTED=0
rollback() {
  trap - ERR
  set +e
  echo "!! failure, restoring previous build"
  sudo systemctl stop dealio
  if [ -d "$B/dist" ]; then rm -rf "$APP/dist"; cp -a "$B/dist" "$APP/dist"; fi
  git -C "$APP" reset -q --hard "$PREV"
  if [ "$STARTED" = 1 ] && [ -f "$B/wishlist.db" ] \
    && [ "$(schema_version "$APP/data/wishlist.db")" != "$(schema_version "$B/wishlist.db")" ]; then
    # The new build migrated the schema; the old build gets the database it knew.
    echo "!! schema version changed, restoring the database from $B"
    rm -f "$APP/data/wishlist.db-wal" "$APP/data/wishlist.db-shm"
    cp -p "$B/wishlist.db" "$APP/data/wishlist.db"
    for f in wishlist.db-wal wishlist.db-shm; do [ -f "$B/$f" ] && cp -p "$B/$f" "$APP/data/$f"; done
  fi
  sudo systemctl start dealio
  echo "!! previous build restarted at $PREV; check the health record"
  exit 1
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
cp -a "$VERIFIED/dist" dist
diff -r dist "$VERIFIED/dist" >/dev/null
echo "dist matches the verified archive"
START_AT=$(node -e 'console.log(new Date().toISOString())')
STARTED=1
sudo systemctl start dealio

echo "waiting up to ${HEALTH_TIMEOUT}s for the new build to report Discord ready"
deadline=$((SECONDS + HEALTH_TIMEOUT))
until node -e '
const health = JSON.parse(require("node:fs").readFileSync(".runtime/bot.health.json", "utf8"));
process.exit(health.startedAt >= process.argv[1] && health.phase === "ready" && health.discordReady === true ? 0 : 1);
' "$START_AT" 2>/dev/null; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "!! the new build did not report ready within ${HEALTH_TIMEOUT}s"
    false
  fi
  sleep 2
done
systemctl is-active --quiet dealio
trap - ERR
rm -rf "$VERIFIED"
echo "HEAD now $(git log --oneline -1); backup in $B"
