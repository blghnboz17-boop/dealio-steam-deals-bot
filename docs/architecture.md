# Architecture

## Initial Design

```text
Discord commands -> configuration repository -> SQLite
                                      ^
Steam wishlist poller -> sale detector -+
                                      |
                                      v
                              Discord DM notifier
```

## Planned Modules

- `src/discord`: bot client, slash commands, and DM delivery
- `src/steam`: wishlist retrieval and price normalization
- `src/domain`: sale detection and duplicate-notification rules
- `src/persistence`: SQLite schema and repositories
- `src/scheduler`: periodic checks

## Open Technical Question

Steam wishlist retrieval must be verified before implementation. The chosen method should be stable, rate-limit aware, and should fail safely when Steam is unavailable.
