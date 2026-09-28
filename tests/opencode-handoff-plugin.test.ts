import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import handoffPlugin, {
  createHandoffPlugin,
  type HandoffPluginInput,
} from "../.opencode/plugins/handoff.js";
import { renderHandoffMarkdown } from "../.opencode/plugins/handoff/render.js";
import { parseHandoffJson } from "../.opencode/plugins/handoff/schema.js";
import { collectNodeGitState } from "../.opencode/plugins/handoff/node-git.js";
import { BoundedEventQueue } from "../.opencode/plugins/handoff/bounded-queue.js";
import { nodeCapabilityFileSystem, type CapabilityFileSystem } from "../.opencode/plugins/handoff/capabilities.js";

const fixtureParent = join(process.cwd(), ".omo", "evidence", "durable-opencode-handoff");
const fixtureRoots: string[] = [];
const gitEnvironment = { GIT_MASTER: "1" };

type FakeClientControls = {
  readonly accessed: string[];
  readonly input: HandoffPluginInput;
  readonly modelCalls: string[];
  failRead(name: "diff" | "messages" | "todo"): void;
  setDiff(paths: readonly string[]): void;
  setMessages(messages: readonly unknown[]): void;
  setTodos(todos: readonly { readonly id: string; readonly content: string; readonly status: string; readonly priority: string }[]): void;
  stallRead(name: "diff" | "messages" | "todo"): void;
};

function git(repository: string, args: readonly string[]): Buffer {
  return execFileSync("git", [...args], { cwd: repository, env: gitEnvironment });
}

async function createRepository(): Promise<string> {
  await mkdir(fixtureParent, { recursive: true });
  const root = await mkdtemp(join(fixtureParent, "task-7-plugin-"));
  fixtureRoots.push(root);
  git(root, ["init", "-b", "main"]);
  await writeFile(join(root, ".gitignore"), ".omo/\n.runtime/\n*.sqlite\n", "utf8");
  await writeFile(join(root, "tracked.txt"), "baseline\n", "utf8");
  git(root, ["add", ".gitignore", "tracked.txt"]);
  git(root, ["-c", "user.name=Handoff Test", "-c", "user.email=handoff@example.invalid", "commit", "-m", "baseline"]);
  return root;
}

function fakeInput(root: string, omitDiff = false): FakeClientControls {
  let todos: readonly { readonly id: string; readonly content: string; readonly status: string; readonly priority: string }[] = [];
  let messages: readonly unknown[] = [];
  let paths: readonly string[] = [];
  const failedReads = new Set<string>();
  const stalledReads = new Set<string>();
  const accessed: string[] = [];
  const modelCalls: string[] = [];
  const methods: Record<string, unknown> = {
    todo: vi.fn(async () => stalledReads.has("todo")
      ? new Promise<never>(() => undefined)
      : { data: todos, error: failedReads.has("todo") ? { message: "private" } : undefined }),
    messages: vi.fn(async () => stalledReads.has("messages")
      ? new Promise<never>(() => undefined)
      : { data: messages, error: failedReads.has("messages") ? { message: "private" } : undefined }),
    ...(omitDiff ? {} : { diff: vi.fn(async () => stalledReads.has("diff")
      ? new Promise<never>(() => undefined)
      : { data: paths.map((file) => ({ file })), error: failedReads.has("diff") ? { message: "private" } : undefined }) }),
  };
  const session = new Proxy(methods, {
    get(target, property, receiver) {
      const name = String(property);
      accessed.push(name);
      if (["prompt", "promptAsync", "summarize", "init"].includes(name)) {
        modelCalls.push(name);
        throw new Error(`forbidden model API: ${name}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return {
    accessed,
    failRead(name) { failedReads.add(name); },
    modelCalls,
    input: { client: { session }, directory: root, worktree: root },
    setDiff(next) { paths = next; },
    setMessages(next) { messages = next; },
    setTodos(next) { todos = next; },
    stallRead(name) { stalledReads.add(name); },
  };
}

async function authority(root: string) {
  return parseHandoffJson(await readFile(join(root, ".omo", "handoff", "BACKTO.json"), "utf8"));
}

function toolContext(root: string, sessionID = "session-plugin") {
  return {
    sessionID,
    messageID: "message-complete",
    agent: "build",
    directory: root,
    worktree: root,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  };
}

function userMessage(sessionID: string, id: string) {
  return {
    id,
    sessionID,
    role: "user" as const,
    time: { created: 1 },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project-local OpenCode handoff plugin", () => {
  it.each(['.omo', '.omo/handoff'] as const)(
    'disables persistence when %s is a junction escaping the canonical worktree',
    async (linkedPath) => {
      // Given
      const root = await createRepository();
      const external = await mkdtemp(join(dirname(root), 'task-security-external-'));
      fixtureRoots.push(external);
      if (linkedPath === '.omo/handoff') await mkdir(join(root, '.omo'));
      await symlink(external, join(root, linkedPath), 'junction');
      const fake = fakeInput(root);

      // When
      const hooks = await createHandoffPlugin(fake.input);

      // Then
      await expect(hooks.tool?.['handoff_complete']?.execute(
        { verification: [{ command: 'handoff-tests', exitCode: 0 }] },
        toolContext(root),
      )).resolves.toMatchObject({ metadata: { status: 'disabled' } });
      await expect(readFile(join(external, 'BACKTO.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(external, 'handoff', 'BACKTO.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it("fails closed without replacing invalid startup authority", async () => {
    // Given
    const root = await createRepository();
    const handoffDirectory = join(root, ".omo", "handoff");
    await mkdir(handoffDirectory, { recursive: true });
    await writeFile(join(handoffDirectory, "BACKTO.json"), "{", "utf8");
    await writeFile(join(handoffDirectory, "BACKTO.md"), "invalid authority\n", "utf8");
    const fake = fakeInput(root);

    // When
    const hooks = await createHandoffPlugin(fake.input);

    // Then
    await expect(readFile(join(handoffDirectory, "BACKTO.json"), "utf8")).resolves.toBe("{");
    await expect(hooks.tool?.["handoff_complete"]?.execute({ verification: [{ command: "project-tests", exitCode: 0 }] }, toolContext(root))).resolves.toMatchObject({ metadata: { status: "disabled" } });
  });

  it("validates existing authority before any filesystem capability probe", async () => {
    // Given
    const root = await createRepository();
    const handoffDirectory = join(root, ".omo", "handoff");
    await mkdir(handoffDirectory, { recursive: true });
    await writeFile(join(handoffDirectory, "BACKTO.json"), "{", "utf8");
    const operations: string[] = [];
    const capabilityFileSystem: CapabilityFileSystem = {
      ensureDirectory: async (path) => { operations.push("ensure"); await nodeCapabilityFileSystem.ensureDirectory(path); },
      exclusiveCreate: async (path, contents) => { operations.push("create"); await nodeCapabilityFileSystem.exclusiveCreate(path, contents); },
      readText: nodeCapabilityFileSystem.readText,
      remove: nodeCapabilityFileSystem.remove,
      replace: nodeCapabilityFileSystem.replace,
    };

    // When
    await createHandoffPlugin(fakeInput(root).input, { capabilityFileSystem });

    // Then
    expect(operations).toEqual([]);
  });

  it("runs the injected filesystem probe after a missing authority is classified as baseline", async () => {
    // Given
    const root = await createRepository();
    const operations: string[] = [];
    const capabilityFileSystem: CapabilityFileSystem = {
      ...nodeCapabilityFileSystem,
      ensureDirectory: async (path) => { operations.push("ensure"); await nodeCapabilityFileSystem.ensureDirectory(path); },
    };

    // When
    await createHandoffPlugin(fakeInput(root).input, { capabilityFileSystem });

    // Then
    expect(operations).toEqual(["ensure"]);
  });

  it.each(["baseline", "idle", "complete"] as const)("starts a safe baseline instead of reconstructing passive %s intent", async (status) => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    const first = await createHandoffPlugin(fake.input);
    const sessionID = "session-passive";
    if (status !== "baseline") {
      await first["chat.message"]?.({ sessionID, messageID: "user" }, { message: userMessage(sessionID, "user"), parts: [] });
    }
    if (status === "idle") await first.event?.({ event: { type: "session.idle", properties: { sessionID } } });
    if (status === "complete") {
      await first.tool?.["handoff_complete"]?.execute({ verification: [{ command: "project-tests", exitCode: 0 }] }, toolContext(root, sessionID));
    }
    const passive = await authority(root);

    // When
    await createHandoffPlugin(fake.input);
    const restarted = await authority(root);

    // Then
    expect(passive.status).toBe(status);
    expect(restarted).toMatchObject({ status: "baseline", activeTask: "Plugin setup baseline" });
    expect(restarted.revision).toBe(passive.revision + 1);
    expect(restarted.sessionId).toBeUndefined();
  });

  it.each(["active", "blocked"] as const)("preserves a matching resumable %s authority during restart", async (status) => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    const first = await createHandoffPlugin(fake.input);
    await first["chat.message"]?.({ sessionID: "session-restart", messageID: "user" }, { message: userMessage("session-restart", "user"), parts: [] });
    if (status === "blocked") {
      await first.event?.({ event: { type: "session.error", properties: { sessionID: "session-restart", error: { name: "ProviderAuthError", data: { message: "private", providerID: "test" } } } } });
    }
    const beforeRestart = await authority(root);

    // When
    await createHandoffPlugin(fake.input);
    const afterRestart = await authority(root);

    // Then
    expect(afterRestart).toEqual(beforeRestart);
  });

  it('continues safely from authoritative JSON when generated Markdown is stale', async () => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    const first = await createHandoffPlugin(fake.input);
    const sessionID = 'session-stale-markdown';
    await first['chat.message']?.({ sessionID, messageID: 'user' }, { message: userMessage(sessionID, 'user'), parts: [] });
    const before = await authority(root);
    await writeFile(join(root, '.omo', 'handoff', 'BACKTO.md'), 'stale generated view\n', 'utf8');

    // When
    const restarted = await createHandoffPlugin(fake.input);
    await restarted['tool.execute.before']?.({ sessionID, callID: 'after-restart', tool: 'bash' }, { args: {} });

    // Then
    expect((await authority(root)).revision).toBe(before.revision + 1);
  });

  it("imports as a plugin and bootstraps only a current schema-valid baseline", async () => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);

    // When
    const hooks = await createHandoffPlugin(fake.input);
    const baseline = await authority(root);

    // Then
    expect(typeof handoffPlugin).toBe("function");
    expect(Object.keys(hooks).sort()).toEqual(["chat.message", "dispose", "event", "tool", "tool.execute.after", "tool.execute.before"]);
    expect(baseline).toMatchObject({ status: "baseline", eventSequence: 1, activeTask: "Plugin setup baseline" });
    expect(baseline.sessionId).toBeUndefined();
    expect(baseline.uncertainty.flags).toEqual(["history-not-reconstructed"]);
    expect(await readFile(join(root, ".omo", "handoff", "BACKTO.md"), "utf8")).toBe(renderHandoffMarkdown(baseline));
    expect(fake.accessed).toEqual(["todo", "messages", "diff", "todo", "messages", "diff"]);
  });

  it("persists activity through hooks, blocks quota-like errors, restarts safely, and completes explicitly", async () => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    const hooks = await createHandoffPlugin(fake.input);
    const sessionID = "session-plugin";
    const baselineRevision = (await authority(root)).revision;

    // When
    await hooks["chat.message"]?.({ sessionID, messageID: "user-1" }, { message: userMessage(sessionID, "user-1"), parts: [] });
    await hooks["tool.execute.before"]?.({ sessionID, callID: "call-1", tool: "bash" }, { args: {} });
    await hooks["tool.execute.after"]?.({ sessionID, callID: "call-1", tool: "bash", args: {} }, { title: "ok", output: "private output", metadata: {} });
    fake.setTodos([{ id: "todo-1", content: "Task 7 integration", status: "completed", priority: "high" }]);
    await hooks.event?.({ event: { type: "todo.updated", properties: { sessionID, todos: [] } } });
    await hooks.event?.({ event: { type: "session.error", properties: { sessionID, error: { name: "APIError", data: { message: "private provider detail", statusCode: 429, isRetryable: true } } } } });
    const blocked = await authority(root);
    await hooks.dispose?.();
    const restarted = await createHandoffPlugin(fake.input);
    await restarted["chat.message"]?.({ sessionID, messageID: "user-2" }, { message: userMessage(sessionID, "user-2"), parts: [] });
    await restarted.event?.({ event: { type: "todo.updated", properties: { sessionID, todos: [] } } });
    const result = await restarted.tool?.["handoff_complete"]?.execute(
      { verification: [{ command: "handoff-typecheck", exitCode: 0 }] },
      toolContext(root),
    );

    // Then
    expect(blocked).toMatchObject({ status: "blocked", failure: { kind: "quota-like" } });
    expect(blocked.revision).toBeGreaterThan(baselineRevision);
    expect(blocked.todos).toMatchObject([{ id: "todo-1", status: "completed" }]);
    expect(JSON.stringify(blocked)).not.toContain("private provider detail");
    expect(result).toMatchObject({ output: "Handoff completed", metadata: { status: "complete" } });
    expect((await authority(root)).status).toBe("complete");
    expect(fake.modelCalls).toEqual([]);
  }, 20_000);

  it("disables persistence when required capabilities are absent", async () => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root, true);

    // When
    const hooks = await createHandoffPlugin(fake.input);
    await hooks["chat.message"]?.({ sessionID: "disabled", messageID: "user" }, { message: userMessage("disabled", "user"), parts: [] });

    // Then
    await expect(readFile(join(root, ".omo", "handoff", "BACKTO.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(hooks.tool?.["handoff_complete"]?.execute({ verification: [{ command: "project-tests", exitCode: 0 }] }, toolContext(root, "disabled"))).resolves.toMatchObject({ metadata: { status: "disabled" } });
  });

  it("rejects mismatched worktrees and incomplete verification evidence", async () => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    const hooks = await createHandoffPlugin(fake.input);
    await hooks["chat.message"]?.({ sessionID: "session-plugin", messageID: "user" }, { message: userMessage("session-plugin", "user"), parts: [] });
    const complete = hooks.tool?.["handoff_complete"];

    // When / Then
    await expect(complete?.execute({ verification: [], }, toolContext(root))).resolves.toMatchObject({ metadata: { status: "rejected" } });
    await expect(complete?.execute(
      { verification: [{ command: "project-tests", exitCode: 0 }] },
      { ...toolContext(root), worktree: join(root, "other-worktree") },
    )).resolves.toMatchObject({ metadata: { status: "rejected" } });
    await writeFile(join(root, "tracked.txt"), "drifted\n", "utf8");
    await expect(complete?.execute(
      { verification: [{ command: "project-tests", exitCode: 0 }] },
      toolContext(root),
    )).resolves.toMatchObject({ metadata: { status: "rejected", reason: "repository-mismatch" } });
    expect((await authority(root)).status).toBe("active");
  });

  it("contains handler failures and bounds a stalled dispose without process or model access", async () => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    let gitReads = 0;
    const hooks = await createHandoffPlugin(fake.input, {
      collectGitState: async () => {
        gitReads += 1;
        if (gitReads > 2) throw new Error("synthetic handler failure");
        return collectNodeGitState(root);
      },
      disposeTimeoutMs: 20,
      flush: async () => new Promise<never>(() => undefined),
    });

    // When
    await expect(hooks["chat.message"]?.({ sessionID: "session", messageID: "user" }, { message: userMessage("session", "user"), parts: [] })).resolves.toBeUndefined();
    await expect(hooks.dispose?.()).resolves.toBeUndefined();

    // Then
    expect(fake.modelCalls).toEqual([]);
    expect((await authority(root)).processDiagnostics).toEqual(expect.arrayContaining([{ code: "event-handler-failed", eventId: expect.any(String), sequence: expect.any(Number), reason: "handler-failed" }]));
    expect(fake.accessed.every((name) => ["todo", "messages", "diff"].includes(name))).toBe(true);
    expect(fake.accessed).not.toEqual(expect.arrayContaining([".runtime", "sqlite", "process-control"]));
  });

  it.each(["todo", "messages", "diff"] as const)("returns from a stalled SDK %s read at the configured bound", async (method) => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    const hooks = await createHandoffPlugin(fake.input, { handlerTimeoutMs: 20 });
    fake.stallRead(method);
    vi.useFakeTimers();

    // When
    const pending = hooks.event?.({ event: { type: "todo.updated", properties: { sessionID: "session-timeout", todos: [] } } });
    await vi.advanceTimersByTimeAsync(20);

    // Then
    await expect(pending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(250);
    await hooks.dispose?.();
    expect(await authority(root)).toMatchObject({
      processDiagnostics: [{ code: "session-collection-unavailable", reason: "queue-timeout" }],
      uncertainty: { flags: ["history-not-reconstructed"] },
    });
  });

  it("contains a completion persistence failure", async () => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    let gitReads = 0;
    const hooks = await createHandoffPlugin(fake.input, {
      collectGitState: async () => {
        gitReads += 1;
        if (gitReads === 5) throw new Error("synthetic completion failure");
        return collectNodeGitState(root);
      },
    });
    await hooks["chat.message"]?.({ sessionID: "session-plugin", messageID: "user" }, { message: userMessage("session-plugin", "user"), parts: [] });

    // When
    const result = await hooks.tool?.["handoff_complete"]?.execute(
      { verification: [{ command: "project-tests", exitCode: 0 }] },
      toolContext(root),
    );

    // Then
    expect(result).toMatchObject({ metadata: { status: "rejected", reason: "handler-failed" } });
    expect((await authority(root)).status).toBe("active");
  });

  it("reports saturation and admits a priority session error instead of silently dropping it", async () => {
    // Given
    const queue = new BoundedEventQueue(1, 1_000);
    const observed: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    // When
    const first = queue.enqueue(async () => { observed.push("active"); await gate; });
    const displaced = queue.enqueue(async () => { observed.push("ordinary"); }, { priority: "ordinary" });
    const providerError = queue.enqueue(async () => { observed.push("provider-error"); }, { priority: "critical" });
    release?.();
    const results = await Promise.all([first, displaced, providerError]);

    // Then
    expect(observed).toEqual(["active", "provider-error"]);
    expect(results).toEqual([
      { kind: "processed" },
      { kind: "rejected", reason: "capacity" },
      { kind: "processed" },
    ]);
    await expect(queue.flush(100)).resolves.toBe(true);
  });

  it("reports a queue handler failure instead of resolving it as success", async () => {
    // Given
    const queue = new BoundedEventQueue(1, 1_000);

    // When
    const result = await queue.enqueue(async () => { throw new Error("private handler detail"); });

    // Then
    expect(result).toEqual({ kind: "handler-failed" });
    await expect(queue.flush(100)).resolves.toBe(true);
  });

  it("contains a non-Error issue-handler rejection and reaches quiescence", async () => {
    // Given
    const queue = new BoundedEventQueue(1, 1_000, async () => { throw "non-error rejection"; });

    // When
    const result = await queue.enqueue(async () => { throw new Error("handler failure"); });

    // Then
    expect(result).toEqual({ kind: "handler-failed" });
    await expect(queue.flush(100)).resolves.toBe(true);
  });

  it("drains work enqueued reentrantly by onIssue before flush resolves", async () => {
    // Given
    const observed: string[] = [];
    let queue: BoundedEventQueue;
    queue = new BoundedEventQueue(1, 1_000, async () => {
      void queue.enqueue(async () => { observed.push("reentrant"); });
    });

    // When
    await queue.enqueue(async () => { throw new Error("handler failure"); });
    const flushed = await queue.flush(100);

    // Then
    expect(flushed).toBe(true);
    expect(observed).toEqual(["reentrant"]);
  });

  it("persists bounded queue-overload uncertainty while retaining a priority provider error", async () => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    let blockEvents = false;
    let releaseEvent: (() => void) | undefined;
    let announceBlocked: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { announceBlocked = resolve; });
    const gate = new Promise<void>((resolve) => { releaseEvent = resolve; });
    const hooks = await createHandoffPlugin(fake.input, {
      eventQueueCapacity: 1,
      collectGitState: async () => {
        if (blockEvents) { announceBlocked?.(); await gate; }
        return collectNodeGitState(root);
      },
    });
    blockEvents = true;

    // When
    const active = hooks["chat.message"]?.({ sessionID: "session-overload", messageID: "user-1" }, { message: userMessage("session-overload", "user-1"), parts: [] });
    await blocked;
    const displaced = hooks["chat.message"]?.({ sessionID: "session-overload", messageID: "user-2" }, { message: userMessage("session-overload", "user-2"), parts: [] });
    const provider = hooks.event?.({ event: { type: "session.error", properties: { sessionID: "session-overload", error: { name: "APIError", data: { message: "private", statusCode: 429, isRetryable: true } } } } });
    blockEvents = false;
    releaseEvent?.();
    await Promise.all([active, displaced, provider]);
    await hooks.dispose?.();
    const persisted = await authority(root);

    // Then
    expect(persisted).toMatchObject({ status: "blocked", failure: { kind: "quota-like" } });
    expect(persisted.processDiagnostics).toEqual(expect.arrayContaining([{ code: "queue-overload", eventId: expect.any(String), sequence: expect.any(Number), reason: "capacity" }]));
    expect(persisted.uncertainty.flags).toContain("event-order-uncertain");
  });

  it.each(["todo", "messages", "diff"] as const)("persists bounded diagnostics when the SDK %s read fails", async (method) => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    const hooks = await createHandoffPlugin(fake.input);
    fake.failRead(method);

    // When
    await hooks.event?.({ event: { type: "todo.updated", properties: { sessionID: "session-sdk", todos: [] } } });

    // Then
    expect(await authority(root)).toMatchObject({
      processDiagnostics: [{ code: "session-collection-unavailable", reason: "sdk-read-failed" }],
      uncertainty: { flags: ["history-not-reconstructed"] },
    });
  });

  it("projects bounded collector metadata and nonzero redaction counters into authoritative JSON", async () => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    fake.setTodos([{ id: "todo-redacted", content: "Inspect /home/private/.env", status: "in_progress", priority: "high" }]);
    fake.setMessages([{ info: { id: "assistant-meta", role: "assistant", tokens: { input: 2, output: 3, reasoning: 5, cache: { read: 7, write: 11 } } } }]);
    fake.setDiff(["src/index.ts", "/home/private/.env"]);
    const hooks = await createHandoffPlugin(fake.input);

    // When
    await hooks.event?.({ event: { type: "todo.updated", properties: { sessionID: "session-meta", todos: [] } } });
    const parsed = await authority(root);

    // Then
    expect(parsed).toMatchObject({
      messageIds: ["assistant-meta"],
      tokens: { input: 2, output: 3, reasoning: 5, cacheRead: 7, cacheWrite: 11 },
      redaction: { fields: 1, values: 0, paths: 1 },
    });
    expect(parsed.eventOutcomes.length).toBeGreaterThan(0);
  });

  it("keeps completion ordered before delayed hooks so they cannot reopen authority", async () => {
    // Given
    const root = await createRepository();
    const fake = fakeInput(root);
    const hooks = await createHandoffPlugin(fake.input);
    const sessionID = "session-ordered-complete";
    await hooks["chat.message"]?.({ sessionID, messageID: "user" }, { message: userMessage(sessionID, "user"), parts: [] });

    // When
    const completion = hooks.tool?.["handoff_complete"]?.execute(
      { verification: [{ command: "project-tests", exitCode: 0 }] },
      toolContext(root, sessionID),
    );
    const delayed = hooks["tool.execute.before"]?.({ sessionID, callID: "delayed", tool: "bash" }, { args: {} });
    const result = await completion;
    await delayed;

    // Then
    expect(result).toMatchObject({ metadata: { status: "complete" } });
    expect((await authority(root)).status).toBe("complete");
  });
});
