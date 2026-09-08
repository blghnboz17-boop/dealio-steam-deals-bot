export const retainedHandoffJson = `{
  "schemaVersion": 1,
  "stateId": "state-task-4-retained",
  "revision": 4,
  "capturedAt": "2026-09-07T16:40:00.000Z",
  "status": "complete",
  "worktree": {
    "worktreePath": "/mnt/c/fixtures/handoff-review",
    "commonDirHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "branch": "review-fixture",
    "head": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "dirtyFingerprint": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  },
  "eventSequence": 4,
  "activeTask": "Explicitly completed",
  "todos": [],
  "changedPaths": [".opencode/plugins/handoff/storage.ts"],
  "verification": [{ "command": "handoff-tests", "exitCode": 0 }],
  "messageIds": [],
  "tokens": {
    "input": 0,
    "output": 0,
    "reasoning": 0,
    "cacheRead": 0,
    "cacheWrite": 0
  },
  "eventOutcomes": [],
  "processDiagnostics": [],
  "redaction": { "fields": 0, "values": 0, "paths": 0, "truncated": 0 },
  "uncertainty": {
    "flags": [],
    "limitations": ["Events before plugin activation are unavailable"]
  }
}
`;

export const retainedHandoffMarkdown = `# BACKTO

## Checkpoint
- State: \`state-task-4-retained\` revision \`4\`
- Schema: \`1\`
- Captured: \`2026-09-07T16:40:00.000Z\`
- Status: \`complete\`
- Event sequence: \`4\`
- Session: not recorded

## Active Task
- Explicitly completed

## Completed Evidence
- None recorded

## Unfinished Work
- None recorded

## Relevant Files
- \`.opencode/plugins/handoff/storage.ts\`

## Verification
- \`npm run test:handoff\` exited \`0\`

## Failure And Uncertainty
- Failure: none recorded
- Limitation: Events before plugin activation are unavailable
- Redactions: fields \`0\`, values \`0\`, paths \`0\`, truncated \`0\`

## Safe Resume Checks
- Parse \`.omo/handoff/BACKTO.json\` as schema \`1\` and require state \`state-task-4-retained\` revision \`4\`.
- Run \`git rev-parse --show-toplevel\` and require \`/mnt/c/fixtures/handoff-review\`.
- Run \`git rev-parse --git-common-dir\` and require SHA-256 \`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\`.
- Run \`git branch --show-current\` and require \`review-fixture\`.
- Run \`git rev-parse HEAD\` and require \`bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\`.
- Hash \`git status --porcelain=v1 -z --untracked-files=all --ignored=no\` and require \`cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\`.
- Stop without repository mutation if any check differs.
`;

export const retainedCorruptHandoffJson = '{"schemaVersion":999,"fixture":"intentionally invalid authority"}\n';

export const retainedLockFixture = {
  host: 'retained-fixture.invalid',
  nonce: '44444444-4444-4444-8444-444444444444',
  pid: 4242,
  processStart: 'synthetic-not-live',
  timestamp: '2026-09-07T16:40:00.000Z',
  worktreeHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
} as const;
