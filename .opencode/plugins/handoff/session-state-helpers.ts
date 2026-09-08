import { createHash } from 'node:crypto';
import type { HandoffState } from "./schema.js";
import type { CheckpointCandidate, SessionEvent, SessionReducerState } from "./session-state.js";
export { safeIdentifier, safeVerification } from './durable-values.js';

export const MAX_IDENTITIES = 500;
export const MAX_OUTCOMES = 100;
export const MAX_DIAGNOSTICS = 20;
const MAX_SESSIONS = 16;

export const ZERO_TOKENS = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 } as const;
export const ZERO_REDACTION = { fields: 0, values: 0, paths: 0, truncated: 0 } as const;

export function appendBounded<T>(values: readonly T[], value: T, maximum: number): readonly T[] {
  return [...values, value].slice(-maximum);
}

export function eventIdentity(event: SessionEvent): string {
  const session = "sessionId" in event ? event.sessionId ?? "unattributed" : "process";
  return `event-${createHash("sha256").update(`${event.kind}\0${session}\0${event.eventId}`).digest("hex")}`;
}

export function initialCandidate(sessionId: string): CheckpointCandidate {
  return {
    sessionId,
    status: "active",
    eventSequence: 0,
    activeTask: "Accepted OpenCode session activity",
    todos: [], changedPaths: [], verification: [], messageIds: [],
    tokens: ZERO_TOKENS, outcomes: [], failure: undefined, uncertainty: [], redaction: ZERO_REDACTION,
  };
}

export function boundSessions(
  sessions: Readonly<Record<string, CheckpointCandidate>>,
  currentId: string,
): Readonly<Record<string, CheckpointCandidate>> {
  const entries = Object.entries(sessions);
  if (entries.length <= MAX_SESSIONS) return sessions;
  const removable = entries
    .filter(([sessionId]) => sessionId !== currentId)
    .sort((left, right) => {
      const leftPassive = left[1].status === "idle" || left[1].status === "complete" ? 0 : 1;
      const rightPassive = right[1].status === "idle" || right[1].status === "complete" ? 0 : 1;
      return leftPassive - rightPassive || left[1].eventSequence - right[1].eventSequence || left[0].localeCompare(right[0]);
    });
  const evicted = removable[0];
  if (evicted === undefined) return sessions;
  return Object.fromEntries(entries.filter(([sessionId]) => sessionId !== evicted[0]));
}

export function restoreSessionReducerState(authority: HandoffState): SessionReducerState {
  const sessionId = authority.sessionId;
  if (sessionId === undefined || (authority.status !== "active" && authority.status !== "blocked")) {
    return createEmptyReducerState();
  }
  return {
    ...createEmptyReducerState(),
    eventSequence: authority.eventSequence,
    sessions: {
      [sessionId]: {
        sessionId, status: authority.status, eventSequence: authority.eventSequence,
        activeTask: authority.activeTask, todos: authority.todos, changedPaths: authority.changedPaths,
        verification: authority.verification, messageIds: authority.messageIds, tokens: authority.tokens,
        outcomes: authority.eventOutcomes, failure: authority.failure, uncertainty: authority.uncertainty.flags,
        redaction: authority.redaction,
      },
    },
    diagnostics: authority.processDiagnostics,
  };
}

export function createEmptyReducerState(): SessionReducerState {
  return {
    revision: 0, eventSequence: 0, baseline: undefined, disposed: false,
    sessions: {}, diagnostics: [], eventIdentities: [], callIdentities: [], messageIdentities: [],
  };
}
