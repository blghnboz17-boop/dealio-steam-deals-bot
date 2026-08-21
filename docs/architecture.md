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
- `src/steam`: wishlist retrieval and price normalization
- `src/domain`: sale, account-generation, and duplicate-notification rules
- `src/persistence`: SQLite schema and repositories
- `src/application`: checks, both schedulers, delivery, lifecycle, health, and locking

## Reliability Model

Steam responses are validated and timed out. Wishlist access uses Steam's `X-EResult` so a private wishlist is not mistaken for an empty one. Sale candidates and delivery attempts are persisted before Discord calls. Delivery is at-least-once: an uncertain Discord outcome can cause a duplicate retry, but a process crash does not silently discard the durable candidate.

Steam polling and notification retries run independently. Per-user coordination serializes setup, checks, delivery, account changes, and deletion. Runtime health is written atomically without user or credential data. A process lock permits one local bot instance per SQLite database and conservatively reclaims only locks whose recorded PID is definitively absent.
