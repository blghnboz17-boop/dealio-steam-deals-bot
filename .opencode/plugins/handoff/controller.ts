import type { Event } from "@opencode-ai/sdk";

import { BoundedEventQueue } from "./bounded-queue.js";
import { checkpointFromReducer, createStateId } from "./checkpoint.js";
import {
  collectSessionSnapshot,
  type SessionReadClient,
  type SessionTokenCounts,
} from "./collector.js";
import { validateGitState, type GitState } from "./git-state.js";
import { createNodeResumeReaders, validateResume } from "./resume.js";
import type { HandoffState } from "./schema.js";
import { restoreSessionReducerState } from "./session-state-helpers.js";
import {
  createSessionReducerState,
  reduceSessionEvent,
  type SessionEvent,
  type SessionReducerState,
} from "./session-state.js";
import type { HandoffStorage } from "./storage.js";
import type { Verification } from './durable-values.js';

const EVENT_QUEUE_CAPACITY = 64;
const SESSION_READ_TIMEOUT_MS = 250;

class EventPersistenceError extends Error {
  readonly name = "EventPersistenceError";
}

export type ControllerOptions = {
  readonly client: SessionReadClient;
  readonly directory: string;
  readonly worktree: string;
  readonly revisionBase: number;
  readonly storage: HandoffStorage;
  readonly collectGitState: () => Promise<GitState>;
  readonly now: () => string;
  readonly handlerTimeoutMs: number;
  readonly initialAuthority?: HandoffState;
  readonly queueCapacity?: number;
};

export type CompletionEvidence = readonly Verification[];

export type CompletionResult =
  | { readonly status: "complete" }
  | { readonly status: "rejected"; readonly reason: string };

export class HandoffController {
  private readonly queue: BoundedEventQueue;
  private readonly stateId: string;
  private reducer: SessionReducerState;
  private sequence: number;
  private lastGitState: GitState | undefined;

  constructor(private readonly options: ControllerOptions) {
    this.stateId = options.initialAuthority?.stateId ?? createStateId();
    this.reducer = options.initialAuthority === undefined
      ? createSessionReducerState()
      : restoreSessionReducerState(options.initialAuthority);
    this.sequence = this.reducer.eventSequence;
    this.lastGitState = options.initialAuthority === undefined ? undefined : {
      ...options.initialAuthority.worktree,
      changedPaths: options.initialAuthority.changedPaths,
    };
    this.queue = new BoundedEventQueue(options.queueCapacity ?? EVENT_QUEUE_CAPACITY, options.handlerTimeoutMs, async (issue) => {
      const event: SessionEvent = {
        kind: "queue.issue",
        eventId: `queue-${issue.reason}-${this.sequence + 1}`,
        sequence: this.nextSequence(),
        reason: issue.reason,
        ...(issue.sessionId === undefined ? {} : { sessionId: issue.sessionId }),
      };
      if (!(await this.process(event, issue.sessionId, this.lastGitState))) throw new EventPersistenceError("Queue issue checkpoint was not committed");
    });
  }

  async setup(): Promise<boolean> {
    if (this.options.initialAuthority !== undefined) return true;
    return this.process({ kind: "setup", eventId: "plugin-setup", sequence: this.nextSequence() });
  }

  chat(sessionId: string, messageId?: string): Promise<void> {
    const event: SessionEvent = {
      kind: "chat.message",
      eventId: messageId ?? `chat-${this.sequence + 1}`,
      sequence: this.nextSequence(),
      sessionId,
      ...(messageId === undefined ? {} : { messageId }),
    };
    return this.enqueueEvent(event, sessionId);
  }

  toolBefore(sessionId: string, callId: string, toolName: string): Promise<void> {
    if (toolName === "handoff_complete") return Promise.resolve();
    const event: SessionEvent = { kind: "tool.before", eventId: `tool-before-${callId}`, sequence: this.nextSequence(), sessionId, callId, tool: toolName };
    return this.enqueueEvent(event, sessionId);
  }

  toolAfter(sessionId: string, callId: string, toolName: string): Promise<void> {
    if (toolName === "handoff_complete") return Promise.resolve();
    const event: SessionEvent = { kind: "tool.after", eventId: `tool-after-${callId}`, sequence: this.nextSequence(), sessionId, callId, tool: toolName, outcome: "succeeded" };
    return this.enqueueEvent(event, sessionId);
  }

  generic(event: Event): Promise<void> {
    switch (event.type) {
      case "todo.updated": {
        const sequence = this.nextSequence();
        return this.enqueueEventOperation(() => this.collectTodo(event.properties.sessionID, sequence), `todo-${sequence}`, event.properties.sessionID);
      }
      case "message.updated": {
        const info = event.properties.info;
        if (info.role !== "assistant") return Promise.resolve();
        const tokens: SessionTokenCounts = {
          input: info.tokens.input,
          output: info.tokens.output,
          reasoning: info.tokens.reasoning,
          cacheRead: info.tokens.cache.read,
          cacheWrite: info.tokens.cache.write,
        };
        const domainEvent: SessionEvent = { kind: "message.updated", eventId: `message-${info.id}`, sequence: this.nextSequence(), sessionId: info.sessionID, messageId: info.id, completed: info.time.completed !== undefined, tokens };
        return this.enqueueEvent(domainEvent, info.sessionID);
      }
      case "session.compacted": {
        const domainEvent: SessionEvent = { kind: "session.compacted", eventId: `compacted-${this.sequence + 1}`, sequence: this.nextSequence(), sessionId: event.properties.sessionID };
        return this.enqueueEvent(domainEvent, event.properties.sessionID);
      }
      case "session.idle": {
        const domainEvent: SessionEvent = { kind: "session.idle", eventId: `idle-${this.sequence + 1}`, sequence: this.nextSequence(), sessionId: event.properties.sessionID };
        return this.enqueueEvent(domainEvent, event.properties.sessionID);
      }
      case "session.error": {
        const error = event.properties.error;
        const safeError = error === undefined ? undefined : {
          name: error.name,
          ...(error.name === "APIError" && error.data.statusCode !== undefined ? { statusCode: error.data.statusCode } : {}),
        };
        const domainEvent: SessionEvent = {
          kind: "session.error",
          eventId: `error-${this.sequence + 1}`,
          sequence: this.nextSequence(),
          ...(event.properties.sessionID === undefined ? {} : { sessionId: event.properties.sessionID }),
          ...(safeError === undefined ? {} : { error: safeError }),
        };
        return this.enqueueEvent(domainEvent, event.properties.sessionID, "critical");
      }
      default:
        return Promise.resolve();
    }
  }

  async complete(sessionId: string, evidence: CompletionEvidence): Promise<CompletionResult> {
    if (evidence.length === 0 || evidence.some((entry) => entry.exitCode !== 0)) {
      return { status: "rejected", reason: "verification-incomplete" };
    }
    let completion: CompletionResult = { status: "rejected", reason: "handler-failed" };
    const event: SessionEvent = { kind: "complete", eventId: `complete-${this.sequence + 1}`, sequence: this.nextSequence(), sessionId, verification: evidence };
    const queued = await this.queue.enqueue(async () => { completion = await this.completeQueued(event, sessionId); }, { priority: "critical", awaitCompletion: true, eventId: event.eventId, sessionId });
    if (queued.kind === "rejected") return { status: "rejected", reason: "queue-overload" };
    if (queued.kind === "timed-out") return { status: "rejected", reason: "queue-timeout" };
    if (queued.kind === "handler-failed") return { status: "rejected", reason: "handler-failed" };
    return completion;
  }

  private async completeQueued(event: Extract<SessionEvent, { readonly kind: "complete" }>, sessionId: string): Promise<CompletionResult> {
    let boundaryGitState: GitState | undefined;
    const validation = await validateResume({
      readers: createNodeResumeReaders(this.options.worktree),
      collectCurrentGitState: async () => {
        const collected = await this.options.collectGitState();
        boundaryGitState = collected;
        return collected;
      },
    });
    if (validation.status !== "safe-to-resume") return { status: "rejected", reason: validation.status === "no-resume" ? "active-state-required" : validation.reason };
    if (validation.checkpoint.checkpointStatus !== "active") return { status: "rejected", reason: "active-state-required" };
    if (validation.checkpoint.sessionId !== sessionId) return { status: "rejected", reason: "session-mismatch" };
    if (boundaryGitState === undefined) return { status: "rejected", reason: "validation-unavailable" };
    const finalGitState = await this.options.collectGitState();
    if (validateGitState(boundaryGitState, finalGitState).status !== "safe-to-resume") return { status: "rejected", reason: "repository-mismatch" };
    const persisted = await this.process(event, sessionId, finalGitState);
    if (!persisted) return { status: "rejected", reason: "persistence-failed" };
    return this.reducer.sessions[sessionId]?.status === "complete"
      ? { status: "complete" }
      : { status: "rejected", reason: "verification-incomplete" };
  }

  async dispose(timeoutMs: number, flush: () => Promise<void>): Promise<void> {
    const event: SessionEvent = { kind: "dispose", eventId: `dispose-${this.sequence + 1}`, sequence: this.nextSequence() };
    await this.enqueueEvent(event, undefined, "critical");
    await this.queue.flush(timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    await Promise.race([flush(), timeout]);
    if (timer !== undefined) clearTimeout(timer);
  }

  private async collectTodo(sessionId: string, sequence: number): Promise<void> {
    const collection = await collectSessionSnapshot({ client: this.options.client, directory: this.options.directory, sessionId, timeoutMs: SESSION_READ_TIMEOUT_MS });
    if (collection.kind !== "collected") {
      if (!(await this.process({ kind: "collection.unavailable", eventId: `collection-${sequence}`, sequence, sessionId, reason: collection.reason }, sessionId))) {
        throw new EventPersistenceError("Collection diagnostic checkpoint was not committed");
      }
      return;
    }
    if (!(await this.process({ kind: "todo.updated", eventId: `todo-${sequence}`, sequence, sessionId, snapshot: collection.snapshot }, sessionId))) {
      throw new EventPersistenceError("Todo checkpoint was not committed");
    }
  }

  private async process(event: SessionEvent, sessionId?: string, stableGitState?: GitState): Promise<boolean> {
    const nextReducer = reduceSessionEvent(this.reducer, event);
    if (nextReducer === this.reducer) return true;
    const gitState = stableGitState ?? await this.options.collectGitState();
    const checkpoint = checkpointFromReducer({ reducer: nextReducer, ...(sessionId === undefined ? {} : { sessionId }), gitState, revisionBase: this.options.revisionBase, stateId: this.stateId, capturedAt: this.options.now() });
    if (checkpoint === undefined) return false;
    const result = await this.options.storage.enqueue(checkpoint);
    if (result.kind !== "committed") return false;
    this.reducer = nextReducer;
    this.lastGitState = gitState;
    return true;
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private async enqueueEvent(event: SessionEvent, sessionId?: string, priority: "critical" | "ordinary" = "ordinary"): Promise<void> {
    await this.enqueueEventOperation(async () => {
      if (!(await this.process(event, sessionId))) throw new EventPersistenceError("Event checkpoint was not committed");
    }, event.eventId, sessionId, priority);
  }

  private async enqueueEventOperation(
    operation: () => Promise<void>,
    eventId: string,
    sessionId?: string,
    priority: "critical" | "ordinary" = "ordinary",
  ): Promise<void> {
    await this.queue.enqueue(operation, { priority, eventId, ...(sessionId === undefined ? {} : { sessionId }) });
  }
}
