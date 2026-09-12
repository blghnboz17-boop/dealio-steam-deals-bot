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
- Polling waits thirty minutes after a completed scan by default (POLL_INTERVAL_HOURS=0.5).
- Notify only when a game changes from not-on-sale to on-sale.
- Avoid duplicate notifications for the same sale.

## Work Continuation

- At the start of a fresh session, inspect `.omo/handoff/BACKTO.json` and the generated `.omo/handoff/BACKTO.md` before unrelated work.
- Treat only schema-valid `BACKTO.json` as authority. `BACKTO.md` is presentation and must never drive a resume decision.
- Resume `active` or `blocked` work only after the technical validator matches the physical worktree, Git common directory, branch, HEAD, dirty fingerprint, revision, and recorded evidence paths. Validate before any repository mutation.
- Report invalid, corrupt, `conflict`, mismatched, or `unsafe-to-resume` state as unsafe and stop without repository mutation.
- Keep `baseline`, `idle`, and `complete` checkpoints readable, but do not let them force stale work.
- This policy is guidance; the validator is the technical safety boundary. Close verified work with `handoff_complete`, not by editing checkpoint files directly.
