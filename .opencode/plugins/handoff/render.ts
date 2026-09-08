import type {
  FailureKind,
  HandoffState,
  HandoffStatus,
  TodoStatus,
} from './schema.js';
import { VERIFICATION_COMMAND_NAMES } from './durable-values.js';

class UnexpectedHandoffVariantError extends Error {
  readonly name = 'UnexpectedHandoffVariantError';
}

const assertNever = (value: never): never => {
  throw new UnexpectedHandoffVariantError(`Unexpected handoff variant: ${String(value)}`);
};

const escapeMarkdown = (value: string): string => value.replace(/[\\`*_[\]<>#]/g, '\\$&');
const inlineCode = (value: string | number): string => `\`${String(value)}\``;

const statusLabel = (status: HandoffStatus): string => {
  switch (status) {
    case 'baseline':
      return 'baseline';
    case 'active':
      return 'active';
    case 'blocked':
      return 'blocked';
    case 'idle':
      return 'idle';
    case 'complete':
      return 'complete';
    case 'conflict':
      return 'conflict';
    case 'unsafe-to-resume':
      return 'unsafe-to-resume';
    default:
      return assertNever(status);
  }
};

const failureLabel = (kind: FailureKind): string => {
  switch (kind) {
    case 'quota-like':
      return 'quota-like provider refusal';
    case 'provider':
      return 'provider failure';
    case 'timeout':
      return 'timeout';
    case 'tool':
      return 'tool failure';
    case 'filesystem':
      return 'filesystem failure';
    case 'validation':
      return 'validation failure';
    case 'capability':
      return 'capability failure';
    case 'unknown':
      return 'unclassified failure';
    default:
      return assertNever(kind);
  }
};

const todoDisposition = (status: TodoStatus): 'completed' | 'unfinished' | 'omitted' => {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'pending':
    case 'in_progress':
      return 'unfinished';
    case 'cancelled':
      return 'omitted';
    default:
      return assertNever(status);
  }
};

const bulletLines = (items: readonly string[]): readonly string[] =>
  items.length === 0 ? ['- None recorded'] : items.map((item) => `- ${item}`);

export const renderHandoffMarkdown = (state: HandoffState): string => {
  const completedEvidence = state.todos.flatMap((todo) => {
    if (todoDisposition(todo.status) !== 'completed') return [];
    const evidence = todo.evidencePaths.length === 0
      ? 'no evidence path recorded'
      : todo.evidencePaths.map(inlineCode).join(', ');
    return [`${inlineCode(todo.id)}: ${escapeMarkdown(todo.summary)} (${evidence})`];
  });
  const unfinishedWork = state.todos.flatMap((todo) =>
    todoDisposition(todo.status) === 'unfinished'
      ? [`${inlineCode(todo.id)} [${inlineCode(todo.status)}]: ${escapeMarkdown(todo.summary)}`]
      : []);
  const verification = state.verification.map((result) =>
    `${inlineCode(VERIFICATION_COMMAND_NAMES[result.command])} exited ${inlineCode(result.exitCode)}`);
  const failure = state.failure === undefined
    ? ['- Failure: none recorded']
    : [
      `- Failure: ${failureLabel(state.failure.kind)}${state.failure.code === undefined ? '' : ` (${inlineCode(state.failure.code)})`}`,
      `- Failure summary: ${escapeMarkdown(state.failure.summary)}`,
    ];
  const uncertainty = [
    ...state.uncertainty.flags.map((flag) => `- Uncertainty: ${inlineCode(flag)}`),
    ...state.uncertainty.limitations.map((limitation) => `- Limitation: ${escapeMarkdown(limitation)}`),
    `- Redactions: fields ${inlineCode(state.redaction.fields)}, values ${inlineCode(state.redaction.values)}, paths ${inlineCode(state.redaction.paths)}, truncated ${inlineCode(state.redaction.truncated)}`,
  ];

  return [
    '# BACKTO',
    '',
    '## Checkpoint',
    `- State: ${inlineCode(state.stateId)} revision ${inlineCode(state.revision)}`,
    `- Schema: ${inlineCode(state.schemaVersion)}`,
    `- Captured: ${inlineCode(state.capturedAt)}`,
    `- Status: ${inlineCode(statusLabel(state.status))}`,
    `- Event sequence: ${inlineCode(state.eventSequence)}`,
    `- Session: ${state.sessionId === undefined ? 'not recorded' : inlineCode(state.sessionId)}`,
    '',
    '## Active Task',
    `- ${escapeMarkdown(state.activeTask)}`,
    '',
    '## Completed Evidence',
    ...bulletLines(completedEvidence),
    '',
    '## Unfinished Work',
    ...bulletLines(unfinishedWork),
    '',
    '## Relevant Files',
    ...bulletLines(state.changedPaths.map(inlineCode)),
    '',
    '## Verification',
    ...bulletLines(verification),
    '',
    '## Failure And Uncertainty',
    ...failure,
    ...uncertainty,
    '',
    '## Safe Resume Checks',
    `- Parse ${inlineCode('.omo/handoff/BACKTO.json')} as schema ${inlineCode(state.schemaVersion)} and require state ${inlineCode(state.stateId)} revision ${inlineCode(state.revision)}.`,
    `- Run ${inlineCode('git rev-parse --show-toplevel')} and require ${inlineCode(state.worktree.worktreePath)}.`,
    `- Run ${inlineCode('git rev-parse --git-common-dir')} and require SHA-256 ${inlineCode(state.worktree.commonDirHash)}.`,
    `- Run ${inlineCode('git branch --show-current')} and require ${inlineCode(state.worktree.branch)}.`,
    `- Run ${inlineCode('git rev-parse HEAD')} and require ${inlineCode(state.worktree.head)}.`,
    `- Hash ${inlineCode('git status --porcelain=v1 -z --untracked-files=all --ignored=no')} and require ${inlineCode(state.worktree.dirtyFingerprint)}.`,
    '- Stop without repository mutation if any check differs.',
    '',
  ].join('\n');
};
