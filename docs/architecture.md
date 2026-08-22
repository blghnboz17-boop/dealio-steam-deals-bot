# Architecture

## Current Design

```text
Discord commands ---------> application services ----------> SQLite
                                  ^                            |
Steam wishlist scheduler ---------+                            |
                                  |                            v
Notification retry scheduler -> durable notification queue -> Discord DM
```

## Modules

- `src/discord`: bot client, slash commands, and DM delivery
- `src/steam`: safe profile parsing, vanity resolution, wishlist retrieval, and price normalization
- `src/domain`: sale, account-generation, and duplicate-notification rules
- `src/persistence`: SQLite schema and repositories
- `src/application`: checks, both schedulers, delivery, lifecycle, health, and locking

## Reliability Model

Steam responses are validated and timed out. Wishlist access uses Steam's `X-EResult` so a private wishlist is not mistaken for an empty one. Sale candidates, deterministic multi-embed batch membership, and delivery attempts are persisted before Discord calls. Delivery is at-least-once: an uncertain Discord outcome can cause a duplicate batch retry, but a process crash does not silently discard the durable candidates.

`SteamIdentityResolver` parses numeric IDs and `/profiles/` links locally. Vanity inputs are resolved through a URL constructed from the fixed HTTPS `ResolveVanityURL` endpoint, the environment-only API key, and a validated vanity name. User-provided URLs are never request targets. Identity resolution, canonical wishlist validation, and the final upsert execute in that order under the same per-user coordinator; only the canonical SteamID64 reaches SQLite.

The `/wishlist` command uses a separate read-only application service. It fetches a live Steam snapshot for the invoking user's configured SteamID64 and never updates check state, sale episodes, or notification records. Discord pagination operates only on that in-memory snapshot. Owner-bound game buttons open modals that update only the selected game's minimum-discount override through the per-user coordinator; the snapshot itself is not refetched.

The `/status` dashboard read path performs no Steam request. It combines the current user configuration, persisted `check_state` summary, current-account notification records, and game-override count. Its buttons mutate enabled state or the global minimum discount through coordinated application services. Queue counts use canonical `notification_log` rows rather than batch parents/items, preventing batch membership from double-counting games.

Database migration v5 adds nullable last-success wishlist metrics to `check_state` and a singleton persisted wishlist poll schedule. Failed or unavailable checks update the latest attempt without erasing the last successful metrics; changing Steam accounts clears those metrics. The scheduler mirrors its exact next automatic target to enabled users' `next_scheduled_at` values and resumes a future persisted target after restart.

Database migration v6 adds the global `minimum_discount_percent`, config-version-scoped `game_discount_threshold` overrides, and an internal episode eligibility flag. Global thresholds survive a Steam-account change, while old game overrides remain isolated to the old configuration generation. The candidate state machine keeps first observations as a baseline, marks later not-on-sale to on-sale episodes eligible, and uses an idempotent episode-keyed insert when an eligible active sale reaches its effective threshold. Thresholds affect candidate creation only; they do not redefine Steam sale state, split episodes, or retire an already-created candidate.

Database migration v7 assigns each user configuration lifetime a random identity. Modal mutations compare this identity, and game mutations additionally compare `config_version`, so a stale interaction cannot write into a configuration deleted and recreated under the same Discord user ID.

Pre-v5 `next_scheduled_at` values are not imported into the singleton because that field previously had no authoritative production writer. The first v5 startup therefore performs one real scheduler cycle when no canonical target exists, then persists the exact completion-based next target.

Notification enable/disable changes run through the same per-user coordinator as setup, checks, delivery, and deletion. Disabling preserves account generation, wishlist state, durable notification queues, batches, and history. Automatic checks distinguish their source and reject stale scheduler work after disable; notification delivery also revalidates `enabled` under the coordinator before claiming queue state. Manual `/check` deliberately remains available but skips DM delivery while disabled. The `/status` component session is owner-bound, expires with disabled controls, and is stopped during application shutdown.

Steam polling and notification retries run independently. Per-user coordination serializes setup, checks, delivery, account changes, and deletion. Runtime health is written atomically without user or credential data. A process lock permits one local bot instance per SQLite database and conservatively reclaims only locks whose recorded PID is definitively absent.
