import { createHash } from "node:crypto";
import type { FailureKind, ProcessDiagnosticRecord, TodoStatus, UncertaintyFlag } from "./schema.js";
import type { CollectedSessionSnapshot, SessionTokenCounts } from "./collector.js";
import type { Verification } from './durable-values.js';
import {
  appendBounded, boundSessions, createEmptyReducerState, eventIdentity, initialCandidate,
  MAX_DIAGNOSTICS, MAX_IDENTITIES, MAX_OUTCOMES, safeIdentifier, safeVerification,
  ZERO_REDACTION, ZERO_TOKENS,
} from "./session-state-helpers.js";

export type EventOutcome = {
  readonly identity: string;
  readonly kind: SessionEvent["kind"];
  readonly outcome: "accepted" | "blocked" | "completed" | "disposed" | "failed" | "started" | "succeeded";
};

export type CheckpointCandidate = {
  readonly sessionId: string;
  readonly status: "active" | "blocked" | "complete" | "idle";
  readonly eventSequence: number;
  readonly activeTask: string;
  readonly todos: CollectedSessionSnapshot["todos"];
  readonly changedPaths: readonly string[];
  readonly verification: readonly Verification[];
  readonly messageIds: readonly string[];
  readonly tokens: SessionTokenCounts;
  readonly outcomes: readonly EventOutcome[];
  readonly failure: { readonly kind: FailureKind; readonly summary: string } | undefined;
  readonly uncertainty: readonly UncertaintyFlag[];
  readonly redaction: { readonly fields: number; readonly values: number; readonly paths: number; readonly truncated: number };
};

export type BaselineCheckpointCandidate = {
  readonly status: "baseline";
  readonly eventSequence: number;
  readonly activeTask: "Plugin setup baseline";
  readonly todos: readonly [];
  readonly changedPaths: readonly [];
  readonly verification: readonly [];
  readonly uncertainty: readonly ["history-not-reconstructed"];
  readonly messageIds: readonly [];
  readonly tokens: SessionTokenCounts;
  readonly outcomes: readonly [];
  readonly redaction: { readonly fields: 0; readonly values: 0; readonly paths: 0; readonly truncated: 0 };
};

export type SessionReducerState = {
  readonly revision: number;
  readonly eventSequence: number;
  readonly baseline: BaselineCheckpointCandidate | undefined;
  readonly disposed: boolean;
  readonly sessions: Readonly<Record<string, CheckpointCandidate>>;
  readonly diagnostics: readonly ProcessDiagnosticRecord[];
  readonly eventIdentities: readonly string[];
  readonly callIdentities: readonly string[];
  readonly messageIdentities: readonly string[];
};

type EventBase = { readonly eventId: string; readonly sequence: number };
type SessionEventBase = EventBase & { readonly sessionId: string };

export type SessionEvent =
  | (EventBase & { readonly kind: "setup" })
  | (SessionEventBase & { readonly kind: "chat.message"; readonly messageId?: string })
  | (SessionEventBase & { readonly kind: "tool.before"; readonly callId: string; readonly tool: string })
  | (SessionEventBase & { readonly kind: "tool.after"; readonly callId: string; readonly tool: string; readonly outcome: "failed" | "succeeded"; readonly verification?: Verification })
  | (SessionEventBase & { readonly kind: "todo.updated"; readonly snapshot: CollectedSessionSnapshot })
  | (SessionEventBase & { readonly kind: "message.updated"; readonly messageId: string; readonly completed: boolean; readonly tokens?: SessionTokenCounts })
  | (SessionEventBase & { readonly kind: "session.compacted" })
  | (SessionEventBase & { readonly kind: "session.idle" })
  | (EventBase & { readonly kind: "session.error"; readonly sessionId?: string; readonly error?: { readonly name: string; readonly statusCode?: number } })
  | (SessionEventBase & { readonly kind: "collection.unavailable"; readonly reason: "queue-timeout" | "sdk-read-failed" })
  | (EventBase & { readonly kind: "queue.issue"; readonly sessionId?: string; readonly reason: "capacity" | "handler-failed" })
  | (SessionEventBase & { readonly kind: "complete"; readonly verification: readonly Verification[] })
  | (EventBase & { readonly kind: "dispose" });

export function createSessionReducerState(): SessionReducerState {
  return createEmptyReducerState();
}

function updateSession(
  state: SessionReducerState,
  event: SessionEvent,
  sessionId: string,
  update: (current: CheckpointCandidate, identity: string) => CheckpointCandidate,
): SessionReducerState {
  const identity = eventIdentity(event);
  const safeSessionId = safeIdentifier(sessionId);
  const current = state.sessions[safeSessionId] ?? initialCandidate(safeSessionId);
  const candidate = update(current, identity);
  return {
    ...state,
    revision: state.revision + 1,
    eventSequence: event.sequence,
    sessions: boundSessions({ ...state.sessions, [safeSessionId]: { ...candidate, eventSequence: event.sequence } }, safeSessionId),
    eventIdentities: appendBounded(state.eventIdentities, identity, MAX_IDENTITIES),
  };
}

function withOutcome(
  candidate: CheckpointCandidate,
  event: SessionEvent,
  identity: string,
  outcome: EventOutcome["outcome"],
): CheckpointCandidate {
  return {
    ...candidate,
    outcomes: appendBounded(candidate.outcomes, { identity, kind: event.kind, outcome }, MAX_OUTCOMES),
  };
}

function ordinaryUpdate(
  current: CheckpointCandidate,
  event: SessionEvent,
  identity: string,
  update: CheckpointCandidate,
): CheckpointCandidate {
  if (current.status === "complete") return withOutcome(current, event, identity, "accepted");
  if (current.status !== "blocked") return update;
  return { ...update, status: "blocked", activeTask: current.activeTask, failure: current.failure };
}

function classifyError(error: Extract<SessionEvent, { kind: "session.error" }>["error"]): FailureKind {
  if (error?.name === "ProviderAuthError") return "provider";
  if (error?.name === "APIError" && error.statusCode === 429) return "quota-like";
  if (error?.name === "APIError") return "provider";
  return "unknown";
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled session event: ${String(value)}`);
}

export function reduceSessionEvent(state: SessionReducerState, event: SessionEvent): SessionReducerState {
  const identity = eventIdentity(event);
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= state.eventSequence || state.eventIdentities.includes(identity)) return state;

  switch (event.kind) {
    case "setup":
      return {
        ...state,
        revision: state.revision + 1,
        eventSequence: event.sequence,
        baseline: {
          status: "baseline",
          eventSequence: event.sequence,
          activeTask: "Plugin setup baseline",
          todos: [],
          changedPaths: [],
          verification: [],
          uncertainty: ["history-not-reconstructed"],
          messageIds: [],
          tokens: ZERO_TOKENS,
          outcomes: [],
          redaction: ZERO_REDACTION,
        },
        eventIdentities: appendBounded(state.eventIdentities, identity, MAX_IDENTITIES),
      };
    case "chat.message": {
      const messageIdentity = event.messageId === undefined ? undefined : `message-${createHash("sha256").update(`${event.sessionId}\0${event.messageId}\0chat`).digest("hex")}`;
      if (messageIdentity !== undefined && state.messageIdentities.includes(messageIdentity)) return state;
      const next = updateSession(state, event, event.sessionId, (current, key) => ({ ...withOutcome(current, event, key, "accepted"), status: "active", activeTask: "Accepted user message", failure: undefined, messageIds: event.messageId === undefined ? current.messageIds : appendBounded(current.messageIds, safeIdentifier(event.messageId), MAX_OUTCOMES) }));
      return messageIdentity === undefined ? next : { ...next, messageIdentities: appendBounded(state.messageIdentities, messageIdentity, MAX_IDENTITIES) };
    }
    case "tool.before": {
      const callIdentity = `call-${createHash("sha256").update(`${event.sessionId}\0${event.callId}\0before`).digest("hex")}`;
      if (state.callIdentities.includes(callIdentity)) return state;
      const next = updateSession(state, event, event.sessionId, (current, key) => ordinaryUpdate(current, event, key, { ...withOutcome(current, event, key, "started"), status: "active", activeTask: "Tool execution started" }));
      return { ...next, callIdentities: appendBounded(state.callIdentities, callIdentity, MAX_IDENTITIES) };
    }
    case "tool.after": {
      const callIdentity = `call-${createHash("sha256").update(`${event.sessionId}\0${event.callId}\0after`).digest("hex")}`;
      if (state.callIdentities.includes(callIdentity)) return state;
      const verification = event.verification === undefined ? null : safeVerification(event.verification);
      const next = updateSession(state, event, event.sessionId, (current, key) => ordinaryUpdate(current, event, key, {
        ...withOutcome(current, event, key, event.outcome), status: event.outcome === "failed" ? "blocked" : "active",
        activeTask: "Tool execution finished",
        verification: verification === null ? current.verification : appendBounded(current.verification, verification, MAX_OUTCOMES),
        ...(event.outcome === "failed" ? { failure: { kind: "tool" as const, summary: "Tool execution failed" } } : {}),
      }));
      return { ...next, callIdentities: appendBounded(state.callIdentities, callIdentity, MAX_IDENTITIES) };
    }
    case "todo.updated":
      return updateSession(state, event, event.sessionId, (current, key) => ordinaryUpdate(current, event, key, {
        ...withOutcome(current, event, key, "accepted"), status: "active", activeTask: "Todo state updated",
        todos: event.snapshot.todos, changedPaths: event.snapshot.changedPaths, messageIds: event.snapshot.messageIds,
        tokens: event.snapshot.tokens,
        redaction: {
          fields: current.redaction.fields + event.snapshot.redaction.fields,
          values: current.redaction.values + event.snapshot.redaction.values,
          paths: current.redaction.paths + event.snapshot.redaction.paths,
          truncated: current.redaction.truncated + event.snapshot.redaction.truncated,
        },
        uncertainty: current.uncertainty.filter((flag) => flag !== "history-not-reconstructed" && flag !== "event-order-uncertain"),
      }));
    case "message.updated": {
      const messageIdentity = `message-${createHash("sha256").update(`${event.sessionId}\0${event.messageId}\0${event.completed ? "completed" : "pending"}`).digest("hex")}`;
      if (state.messageIdentities.includes(messageIdentity)) return state;
      const next = updateSession(state, event, event.sessionId, (current, key) => ordinaryUpdate(current, event, key, { ...withOutcome(current, event, key, "accepted"), status: "active", activeTask: event.completed ? "Assistant message completed" : "Assistant message pending", messageIds: appendBounded(current.messageIds, safeIdentifier(event.messageId), MAX_OUTCOMES), tokens: event.tokens ?? current.tokens }));
      return { ...next, messageIdentities: appendBounded(state.messageIdentities, messageIdentity, MAX_IDENTITIES) };
    }
    case "session.compacted":
      return updateSession(state, event, event.sessionId, (current, key) => ordinaryUpdate(current, event, key, { ...withOutcome(current, event, key, "accepted"), status: "active", activeTask: "Session compacted", uncertainty: [...new Set([...current.uncertainty, "history-not-reconstructed" as const])] }));
    case "session.idle":
      return updateSession(state, event, event.sessionId, (current, key) => ordinaryUpdate(current, event, key, { ...withOutcome(current, event, key, "accepted"), status: "idle", activeTask: "Session idle" }));
    case "session.error": {
      const activeIds = Object.values(state.sessions).filter((candidate) => candidate.status === "active").map((candidate) => candidate.sessionId);
      const attributedId = event.sessionId ?? (activeIds.length === 1 ? activeIds[0] : undefined);
      if (attributedId === undefined) {
        const reason = event.error === undefined && activeIds.length === 0 ? "session-and-error-missing" : "ambiguous-active-session";
        return { ...state, revision: state.revision + 1, eventSequence: event.sequence, diagnostics: appendBounded(state.diagnostics, { code: "unattributed-session-error", eventId: safeIdentifier(event.eventId), sequence: event.sequence, reason }, MAX_DIAGNOSTICS), eventIdentities: appendBounded(state.eventIdentities, identity, MAX_IDENTITIES) };
      }
      return updateSession(state, event, attributedId, (current, key) => current.status === "complete"
        ? withOutcome(current, event, key, "blocked")
        : { ...withOutcome(current, event, key, "blocked"), status: "blocked", activeTask: "Session blocked by error", failure: { kind: classifyError(event.error), summary: "OpenCode session error" }, uncertainty: event.sessionId === undefined ? [...new Set([...current.uncertainty, "session-id-missing" as const])] : current.uncertainty });
    }
    case "collection.unavailable": {
      const next = updateSession(state, event, event.sessionId, (current, key) => ordinaryUpdate(current, event, key, {
        ...withOutcome(current, event, key, "failed"),
        status: "active",
        activeTask: "Session collection unavailable",
        uncertainty: [...new Set([...current.uncertainty, "history-not-reconstructed" as const])],
      }));
      return {
        ...next,
        diagnostics: appendBounded(next.diagnostics, { code: "session-collection-unavailable", eventId: safeIdentifier(event.eventId), sequence: event.sequence, reason: event.reason }, MAX_DIAGNOSTICS),
      };
    }
    case "queue.issue": {
      const diagnostic = { code: event.reason === "capacity" ? "queue-overload" as const : "event-handler-failed" as const, eventId: safeIdentifier(event.eventId), sequence: event.sequence, reason: event.reason };
      if (event.sessionId === undefined) {
        return { ...state, revision: state.revision + 1, eventSequence: event.sequence, diagnostics: appendBounded(state.diagnostics, diagnostic, MAX_DIAGNOSTICS), eventIdentities: appendBounded(state.eventIdentities, identity, MAX_IDENTITIES) };
      }
      const next = updateSession(state, event, event.sessionId, (current, key) => ordinaryUpdate(current, event, key, {
        ...withOutcome(current, event, key, "failed"), status: "active", activeTask: "Lifecycle event uncertainty",
        uncertainty: [...new Set([...current.uncertainty, "event-order-uncertain" as const])],
      }));
      return { ...next, diagnostics: appendBounded(next.diagnostics, diagnostic, MAX_DIAGNOSTICS) };
    }
    case "complete":
      return updateSession(state, event, event.sessionId, (current, key) => {
        const settled = current.todos.every((todo) => todo.status !== ("pending" satisfies TodoStatus) && todo.status !== ("in_progress" satisfies TodoStatus));
        const verification = event.verification.map(safeVerification).filter((result): result is Verification => result !== null);
        const passed = verification.length === event.verification.length && verification.length > 0 && verification.every((result) => result.exitCode === 0);
        const reconciled = current.uncertainty.length === 0;
        return current.status === "active" && settled && passed && reconciled
          ? { ...withOutcome(current, event, key, "completed"), status: "complete", activeTask: "Explicitly completed", verification, failure: undefined, uncertainty: current.uncertainty }
          : { ...withOutcome(current, event, key, "failed"), status: "blocked", activeTask: "Completion evidence incomplete", verification, failure: { kind: "validation", summary: "Explicit completion was not verified" }, uncertainty: [...new Set([...current.uncertainty, "verification-incomplete" as const])] };
      });
    case "dispose":
      return { ...state, revision: state.revision + 1, eventSequence: event.sequence, disposed: true, eventIdentities: appendBounded(state.eventIdentities, identity, MAX_IDENTITIES) };
    default:
      return assertNever(event);
  }
}
