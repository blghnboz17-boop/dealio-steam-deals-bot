import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createHandoffPlugin, type HandoffPluginInput } from "../.opencode/plugins/handoff.js";
import { collectNodeGitState } from "../.opencode/plugins/handoff/node-git.js";
import { createNodeResumeReaders, validateResume } from "../.opencode/plugins/handoff/resume.js";
import { parseHandoffJson } from "../.opencode/plugins/handoff/schema.js";

const fixtureParent = join(process.cwd(), ".omo", "evidence", "durable-opencode-handoff");
const fixtureRoots: string[] = [];
const gitEnvironment = { GIT_MASTER: "1" } as const;

function git(repository: string, args: readonly string[]): Buffer {
  return execFileSync("git", [...args], { cwd: repository, env: gitEnvironment });
}

async function createRepository(): Promise<{ readonly fixtureRoot: string; readonly repository: string }> {
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRoot = await mkdtemp(join(fixtureParent, "task-8-e2e-"));
  fixtureRoots.push(fixtureRoot);
  const repository = join(fixtureRoot, "repository");
  await mkdir(repository);
  git(repository, ["init", "-b", "main"]);
  await writeFile(join(repository, ".gitignore"), ".omo/\n", "utf8");
  await writeFile(join(repository, "tracked.txt"), "baseline\n", "utf8");
  git(repository, ["add", ".gitignore", "tracked.txt"]);
  git(repository, ["-c", "user.name=Handoff E2E", "-c", "user.email=handoff@example.invalid", "commit", "-m", "baseline"]);
  return { fixtureRoot, repository };
}

function fakeInput(repository: string): HandoffPluginInput {
  return {
    client: {
      session: new Proxy({
        todo: vi.fn(async () => ({ data: [], error: undefined })),
        messages: vi.fn(async () => ({ data: [], error: undefined })),
        diff: vi.fn(async () => ({ data: [], error: undefined })),
      }, {
        get(target, property, receiver) {
          if (["prompt", "promptAsync", "summarize", "init"].includes(String(property))) {
            throw new Error("Model APIs are forbidden in the recovery fixture");
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    },
    directory: repository,
    worktree: repository,
  };
}

async function authority(repository: string) {
  return parseHandoffJson(await readFile(join(repository, ".omo", "handoff", "BACKTO.json"), "utf8"));
}

function completionContext(repository: string, sessionID: string) {
  return {
    sessionID,
    messageID: "completion-message",
    agent: "build",
    directory: repository,
    worktree: repository,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  };
}

async function waitForBlockedWriter(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolveBlocked, rejectBlocked) => {
    child.once("error", rejectBlocked);
    child.on("message", (message) => {
      if (message !== "json-write-blocked") return;
      child.kill();
      resolveBlocked();
    });
  });
  await once(child, "exit");
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("isolated durable handoff recovery", () => {
  it("checkpoints before a provider error and completion prevents stale resume", async () => {
    // Given
    const { repository } = await createRepository();
    const sessionID = "session-task-8-provider";
    const hooks = await createHandoffPlugin(fakeInput(repository), { handlerTimeoutMs: 10_000 });
    await hooks["chat.message"]?.({ sessionID, messageID: "user-1" }, { message: { id: "user-1", sessionID, role: "user", time: { created: 1 }, agent: "build", model: { providerID: "test", modelID: "test" } }, parts: [] });
    const beforeError = await authority(repository);

    // When
    await hooks.event?.({ event: { type: "session.error", properties: { sessionID, error: { name: "APIError", data: { message: "provider unavailable", statusCode: 429, isRetryable: true } } } } });
    const blocked = await authority(repository);
    const resumable = await validateResume({ readers: createNodeResumeReaders(repository), collectCurrentGitState: () => collectNodeGitState(repository) });
    await hooks["chat.message"]?.({ sessionID, messageID: "user-2" }, { message: { id: "user-2", sessionID, role: "user", time: { created: 2 }, agent: "build", model: { providerID: "test", modelID: "test" } }, parts: [] });
    const completed = await hooks.tool?.["handoff_complete"]?.execute({ verification: [{ command: "handoff-typecheck", exitCode: 0 }] }, completionContext(repository, sessionID));
    const afterCompletion = await validateResume({ readers: createNodeResumeReaders(repository), collectCurrentGitState: () => collectNodeGitState(repository) });

    // Then
    expect(beforeError.status).toBe("active");
    expect(blocked).toMatchObject({ status: "blocked", failure: { kind: "quota-like" } });
    expect(blocked.revision).toBeGreaterThan(beforeError.revision);
    expect(resumable.status).toBe("safe-to-resume");
    expect(completed).toMatchObject({ metadata: { status: "complete" } });
    expect(afterCompletion).toMatchObject({ status: "no-resume", checkpoint: { checkpointStatus: "complete" } });
    console.log(JSON.stringify({ scenario: "provider-restart-completion", checkpointBeforeError: beforeError.status, providerFailure: blocked.failure?.kind, freshSession: resumable.status, completion: afterCompletion.status }));
  }, 15_000);

  it("preserves prior authority when a writer process is terminated between revisions", async () => {
    // Given
    const { repository } = await createRepository();
    const sessionID = "session-task-8-interruption";
    const hooks = await createHandoffPlugin(fakeInput(repository));
    await hooks["chat.message"]?.({ sessionID, messageID: "user-1" }, { message: { id: "user-1", sessionID, role: "user", time: { created: 1 }, agent: "build", model: { providerID: "test", modelID: "test" } }, parts: [] });
    const authorityPath = join(repository, ".omo", "handoff", "BACKTO.json");
    const priorBytes = await readFile(authorityPath, "utf8");
    const scriptPath = join(repository, ".omo", "interrupt-writer.ts");
    const storageUrl = pathToFileURL(resolve(".opencode/plugins/handoff/storage.ts")).href;
    const schemaUrl = pathToFileURL(resolve(".opencode/plugins/handoff/schema.ts")).href;
    const renderUrl = pathToFileURL(resolve(".opencode/plugins/handoff/render.ts")).href;
    await mkdir(join(repository, ".omo"), { recursive: true });
    await writeFile(scriptPath, [
      `import { readFile } from "node:fs/promises";`,
      `import { createHandoffStorage, nodeStorageFileSystem } from ${JSON.stringify(storageUrl)};`,
      `import { parseHandoffJson, parseHandoffState } from ${JSON.stringify(schemaUrl)};`,
      `import { renderHandoffMarkdown } from ${JSON.stringify(renderUrl)};`,
      `const directory = ${JSON.stringify(join(repository, ".omo", "handoff"))};`,
      `const prior = parseHandoffJson(await readFile(directory + "/BACKTO.json", "utf8"));`,
      `const fileSystem = { ...nodeStorageFileSystem, openExclusive: async (path: string) => {`,
      `  const file = await nodeStorageFileSystem.openExclusive(path);`,
      `  if (!path.includes(".BACKTO.json.tmp-")) return file;`,
      `  return { close: file.close, writeText: async () => { process.send?.("json-write-blocked"); await new Promise<never>(() => undefined); } };`,
      `} };`,
      `const next = parseHandoffState({ ...prior, revision: prior.revision + 1, eventSequence: prior.eventSequence + 1, capturedAt: "2026-09-07T12:00:00.000Z" });`,
      `await createHandoffStorage({ directory, worktreeHash: "a".repeat(64) }, { fileSystem, renderMarkdown: renderHandoffMarkdown, runtime: { host: "task-8", nonce: () => "88888888-8888-4888-8888-888888888888", now: () => "2026-09-07T12:00:00.000Z", ownerState: async () => "dead", pid: process.pid, processStart: "task-8" } }).enqueue(next);`,
    ].join("\n"), "utf8");
    const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const child = spawn(process.execPath, [tsxCli, scriptPath], { cwd: repository, stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });

    // When
    await waitForBlockedWriter(child);
    const retainedBytes = await readFile(authorityPath, "utf8");
    const resumed = await validateResume({ readers: createNodeResumeReaders(repository), collectCurrentGitState: () => collectNodeGitState(repository) });

    // Then
    expect(retainedBytes).toBe(priorBytes);
    expect(resumed.status).toBe("safe-to-resume");
    console.log(JSON.stringify({ scenario: "process-interruption", priorAuthorityPreserved: retainedBytes === priorBytes, freshSession: resumed.status }));
  });

  it("refuses authority from another real linked worktree", async () => {
    // Given
    const { fixtureRoot, repository } = await createRepository();
    const linkedWorktree = join(fixtureRoot, "linked-worktree");
    git(repository, ["worktree", "add", "-b", "linked", linkedWorktree]);
    const hooks = await createHandoffPlugin(fakeInput(repository));
    await hooks["chat.message"]?.({ sessionID: "session-primary", messageID: "user" }, { message: { id: "user", sessionID: "session-primary", role: "user", time: { created: 1 }, agent: "build", model: { providerID: "test", modelID: "test" } }, parts: [] });

    // When
    const result = await validateResume({ readers: createNodeResumeReaders(repository), collectCurrentGitState: () => collectNodeGitState(linkedWorktree) });

    // Then
    expect(result).toMatchObject({ status: "unsafe-to-resume", reason: "repository-mismatch" });
    if (result.status === "unsafe-to-resume" && result.reason === "repository-mismatch") expect(result.mismatches).toContain("worktree-path");
    console.log(JSON.stringify({ scenario: "second-worktree", result: result.status }));
  });

  it("fails closed when authoritative state is corrupt", async () => {
    // Given
    const { repository } = await createRepository();
    const handoffDirectory = join(repository, ".omo", "handoff");
    await mkdir(handoffDirectory, { recursive: true });
    await writeFile(join(handoffDirectory, "BACKTO.json"), "{", "utf8");
    await writeFile(join(handoffDirectory, "BACKTO.md"), "not authority\n", "utf8");

    // When
    const result = await validateResume({ readers: createNodeResumeReaders(repository), collectCurrentGitState: () => collectNodeGitState(repository) });

    // Then
    expect(result).toEqual({ status: "unsafe-to-resume", reason: "invalid-authority" });
    console.log(JSON.stringify({ scenario: "corrupt-authority", result: result.status, reason: result.status === "unsafe-to-resume" ? result.reason : "unexpected" }));
  });
});
