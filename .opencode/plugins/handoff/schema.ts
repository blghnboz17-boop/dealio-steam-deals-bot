import { isAbsolute } from 'node:path';
import { z } from 'zod';
import {
  containsSensitiveValue,
  isSafeRelativePath,
  MAX_PERSISTED_TEXT_LENGTH,
  redactText,
} from './redaction.js';
import { isCanonicalBranch, isCanonicalIdentifier, VERIFICATION_COMMAND_IDS } from './durable-values.js';

export const HANDOFF_SCHEMA_VERSION = 1 as const;
export const HANDOFF_STATUSES = [
  'baseline',
  'active',
  'blocked',
  'idle',
  'complete',
  'conflict',
  'unsafe-to-resume',
] as const;
export const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
export const FAILURE_KINDS = [
  'quota-like',
  'provider',
  'timeout',
  'tool',
  'filesystem',
  'validation',
  'capability',
  'unknown',
] as const;
export const UNCERTAINTY_FLAGS = [
  'session-id-missing',
  'event-order-uncertain',
  'tool-result-unavailable',
  'verification-unavailable',
  'verification-incomplete',
  'history-not-reconstructed',
  'write-capability-limited',
] as const;
const EVENT_KINDS = [
  'setup', 'chat.message', 'tool.before', 'tool.after', 'todo.updated',
  'message.updated', 'session.compacted', 'session.idle', 'session.error',
  'collection.unavailable', 'queue.issue', 'complete', 'dispose',
] as const;
const EVENT_OUTCOMES = ['accepted', 'blocked', 'completed', 'disposed', 'failed', 'started', 'succeeded'] as const;
const DIAGNOSTIC_CODES = ['unattributed-session-error', 'session-collection-unavailable', 'event-handler-failed', 'queue-overload'] as const;
const DIAGNOSTIC_REASONS = ['ambiguous-active-session', 'session-and-error-missing', 'queue-timeout', 'sdk-read-failed', 'handler-failed', 'capacity'] as const;

const boundedTextSchema = z.string()
  .min(1)
  .max(MAX_PERSISTED_TEXT_LENGTH)
  .refine((value) => !containsSensitiveValue(value), 'Sensitive values are forbidden')
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), 'Control characters are forbidden')
  .transform((value) => redactText(value).value)
  .brand('SafePersistedText');
const identifierSchema = z.string().min(1).max(128).refine(isCanonicalIdentifier, 'Unsafe identifier');
const relativePathSchema = z.string().refine(isSafeRelativePath, 'Unsafe repository-relative path').brand('SafeRelativePath');
const counterSchema = z.number().int().nonnegative().safe();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const absolutePathSchema = z.string()
  .min(1)
  .max(500)
  .regex(/^[A-Za-z0-9._@+(), /:-]+$/)
  .refine(isAbsolute, 'Worktree root must be absolute');

const WorktreeIdentitySchema = z.strictObject({
  worktreePath: absolutePathSchema,
  commonDirHash: sha256Schema,
  branch: z.string().max(256).regex(/^[A-Za-z0-9._/-]*$/).refine(isCanonicalBranch, 'Unsafe branch identifier'),
  head: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  dirtyFingerprint: sha256Schema,
}).readonly();

const TodoSummarySchema = z.strictObject({
  id: identifierSchema,
  summary: boundedTextSchema,
  status: z.enum(TODO_STATUSES),
  evidencePaths: z.array(relativePathSchema).max(20).readonly(),
}).readonly();

const VerificationResultSchema = z.strictObject({
  command: z.enum(VERIFICATION_COMMAND_IDS),
  exitCode: counterSchema,
}).readonly();

const TokenTotalsSchema = z.strictObject({
  input: counterSchema,
  output: counterSchema,
  reasoning: counterSchema,
  cacheRead: counterSchema,
  cacheWrite: counterSchema,
}).readonly();

const EventOutcomeSchema = z.strictObject({
  identity: identifierSchema,
  kind: z.enum(EVENT_KINDS),
  outcome: z.enum(EVENT_OUTCOMES),
}).readonly();

const ProcessDiagnosticSchema = z.strictObject({
  code: z.enum(DIAGNOSTIC_CODES),
  eventId: identifierSchema,
  sequence: counterSchema,
  reason: z.enum(DIAGNOSTIC_REASONS),
}).readonly();

const failureVariant = <Kind extends (typeof FAILURE_KINDS)[number]>(kind: Kind) =>
  z.strictObject({
    kind: z.literal(kind),
    code: identifierSchema.optional(),
    summary: boundedTextSchema,
  }).readonly();

const FailureSummarySchema = z.discriminatedUnion('kind', [
  failureVariant('quota-like'),
  failureVariant('provider'),
  failureVariant('timeout'),
  failureVariant('tool'),
  failureVariant('filesystem'),
  failureVariant('validation'),
  failureVariant('capability'),
  failureVariant('unknown'),
]);

const RedactionSummarySchema = z.strictObject({
  fields: counterSchema,
  values: counterSchema,
  paths: counterSchema,
  truncated: counterSchema,
}).readonly();

const UncertaintySummarySchema = z.strictObject({
  flags: z.array(z.enum(UNCERTAINTY_FLAGS)).max(32).readonly(),
  limitations: z.array(boundedTextSchema).max(32).readonly(),
}).readonly();

export const HandoffStateSchema = z.strictObject({
  schemaVersion: z.literal(HANDOFF_SCHEMA_VERSION),
  stateId: identifierSchema,
  revision: counterSchema,
  capturedAt: z.iso.datetime({ offset: false, precision: 3 }),
  status: z.enum(HANDOFF_STATUSES),
  worktree: WorktreeIdentitySchema,
  sessionId: identifierSchema.optional(),
  eventSequence: counterSchema,
  activeTask: boundedTextSchema,
  todos: z.array(TodoSummarySchema).max(100).readonly(),
  changedPaths: z.array(relativePathSchema).max(200).readonly(),
  verification: z.array(VerificationResultSchema).max(100).readonly(),
  messageIds: z.array(identifierSchema).max(100).readonly().default([]),
  tokens: TokenTotalsSchema.default({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }),
  eventOutcomes: z.array(EventOutcomeSchema).max(100).readonly().default([]),
  processDiagnostics: z.array(ProcessDiagnosticSchema).max(20).readonly().default([]),
  failure: FailureSummarySchema.optional(),
  redaction: RedactionSummarySchema,
  uncertainty: UncertaintySummarySchema,
}).superRefine((state, context) => {
  if (state.status !== 'complete') return;

  if (state.todos.some((todo) => todo.status === 'pending' || todo.status === 'in_progress')) {
    context.addIssue({ code: 'custom', path: ['todos'], message: 'Complete state has unfinished work' });
  }
  if (state.verification.some((result) => result.exitCode !== 0)) {
    context.addIssue({ code: 'custom', path: ['verification'], message: 'Complete state has failed verification' });
  }
  if (state.verification.length === 0) {
    context.addIssue({ code: 'custom', path: ['verification'], message: 'Complete state lacks verification evidence' });
  }
  if (state.failure !== undefined) {
    context.addIssue({ code: 'custom', path: ['failure'], message: 'Complete state has a failure' });
  }
  if (state.uncertainty.flags.length !== 0) {
    context.addIssue({ code: 'custom', path: ['uncertainty', 'flags'], message: 'Complete state has unresolved uncertainty' });
  }
}).readonly().brand('ValidatedHandoffState');

export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];
export type TodoStatus = (typeof TODO_STATUSES)[number];
export type FailureKind = (typeof FAILURE_KINDS)[number];
export type UncertaintyFlag = (typeof UNCERTAINTY_FLAGS)[number];
export type EventKind = (typeof EVENT_KINDS)[number];
export type EventOutcomeRecord = z.infer<typeof EventOutcomeSchema>;
export type ProcessDiagnosticRecord = z.infer<typeof ProcessDiagnosticSchema>;
export type HandoffState = z.infer<typeof HandoffStateSchema>;
export type WorktreeIdentity = HandoffState['worktree'];
export type TodoSummary = HandoffState['todos'][number];
export type VerificationResult = HandoffState['verification'][number];
export type FailureSummary = NonNullable<HandoffState['failure']>;
export type RedactionSummary = HandoffState['redaction'];
export type UncertaintySummary = HandoffState['uncertainty'];
export type SafeRelativePath = HandoffState['changedPaths'][number];

export class HandoffJsonSyntaxError extends SyntaxError {
  readonly name = 'HandoffJsonSyntaxError';
}

export const parseHandoffState = (value: unknown): HandoffState => HandoffStateSchema.parse(value);

export const parseHandoffJson = (serialized: string): HandoffState => {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new HandoffJsonSyntaxError('Authoritative handoff JSON is malformed', { cause: error });
    }
    throw error;
  }
  const parsed = parseHandoffState(value);
  const canonicalText = z.object({
    activeTask: z.string(),
    todos: z.array(z.object({ summary: z.string() })),
    failure: z.object({ summary: z.string() }).optional(),
    uncertainty: z.object({ limitations: z.array(z.string()) }),
  }).parse(value);
  const textValues = [
    canonicalText.activeTask,
    ...canonicalText.todos.map((todo) => todo.summary),
    ...(canonicalText.failure === undefined ? [] : [canonicalText.failure.summary]),
    ...canonicalText.uncertainty.limitations,
  ];
  if (textValues.some((text) => redactText(text).value !== text)) {
    throw new HandoffJsonSyntaxError('Authoritative handoff JSON contains noncanonical text');
  }
  return parsed;
};
