# Project Instructions

## Goal

Notify Discord users by direct message when games on their Steam wishlist go on sale.

## Rules

- Use TypeScript with strict mode.
- Keep Steam, Discord, persistence, and scheduling code in separate modules.
- Never commit secrets. Read tokens and IDs from environment variables.
- Use Node's built-in `node:sqlite` module for the first version; avoid native database dependencies.
- Add tests for price-change and duplicate-notification logic.
- External requests must have timeouts and must not turn an unavailable API into a false sale.
- Run `npm run typecheck` and `npm test` after implementation changes.

## First Version Scope

- One or more Discord users can configure a Steam wishlist.
- Polling runs every six hours by default.
- Notify only when a game changes from not-on-sale to on-sale.
- Avoid duplicate notifications for the same sale.
