import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HANDOFF_EVENT_TYPES,
  HANDOFF_HOOK_NAMES,
  nodeCapabilityFileSystem,
  preflightHandoffCapabilities,
  type CapabilityFileSystem,
} from "../.opencode/plugins/handoff/capabilities.js";

const fixtureParent = join(
  process.cwd(),
  ".omo",
  "evidence",
  "durable-opencode-handoff",
);
const fixtureDirectories: string[] = [];

const supportedClient = {
  session: {
    diff: () => undefined,
    messages: () => undefined,
    todo: () => undefined,
  },
};

const supportedHooks = {
  "chat.message": () => undefined,
  "tool.execute.after": () => undefined,
  "tool.execute.before": () => undefined,
  dispose: () => undefined,
  event: () => undefined,
};

async function createFixtureDirectory(): Promise<string> {
  await mkdir(fixtureParent, { recursive: true });
  const directory = await mkdtemp(join(fixtureParent, "task-1-test-"));
  fixtureDirectories.push(directory);
  return directory;
}

function withFailure(
  operation: keyof CapabilityFileSystem,
  secret: string,
): CapabilityFileSystem {
  return {
    ensureDirectory:
      operation === "ensureDirectory"
        ? async () => {
            throw new Error(secret);
          }
        : nodeCapabilityFileSystem.ensureDirectory,
    exclusiveCreate:
      operation === "exclusiveCreate"
        ? async () => {
            throw new Error(secret);
          }
        : nodeCapabilityFileSystem.exclusiveCreate,
    readText:
      operation === "readText"
        ? async () => {
            throw new Error(secret);
          }
        : nodeCapabilityFileSystem.readText,
    remove:
      operation === "remove"
        ? async () => {
            throw new Error(secret);
          }
        : nodeCapabilityFileSystem.remove,
    replace:
      operation === "replace"
        ? async () => {
            throw new Error(secret);
          }
        : nodeCapabilityFileSystem.replace,
  };
}

afterEach(async () => {
  await Promise.all(fixtureDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

describe("handoff capability preflight", () => {
  it("enables persistence when the exact runtime and DrvFS operations are supported", async () => {
    // Given
    const directory = await createFixtureDirectory();

    // When
    const result = await preflightHandoffCapabilities({
      client: supportedClient,
      eventTypes: HANDOFF_EVENT_TYPES,
      fileSystem: nodeCapabilityFileSystem,
      handoffDirectory: directory,
      hooks: supportedHooks,
    });

    // Then
    expect(result).toEqual({ diagnostics: [], status: "enabled" });
  });

  it.each(["todo", "messages", "diff"])(
    "disables persistence when client.session.%s is missing",
    async (missingMethod) => {
      // Given
      const directory = await createFixtureDirectory();
      const session = Object.fromEntries(
        Object.entries(supportedClient.session).filter(([name]) => name !== missingMethod),
      );

      // When
      const result = await preflightHandoffCapabilities({
        client: { session },
        eventTypes: HANDOFF_EVENT_TYPES,
        fileSystem: nodeCapabilityFileSystem,
        handoffDirectory: directory,
        hooks: supportedHooks,
      });

      // Then
      expect(result).toEqual({
        diagnostics: [{ code: "runtime-capability-missing", capability: `client.session.${missingMethod}` }],
        status: "disabled",
      });
    },
  );

  it.each(HANDOFF_HOOK_NAMES)(
    "disables persistence when the %s plugin hook is missing",
    async (missingHook) => {
      // Given
      const directory = await createFixtureDirectory();
      const hooks = Object.fromEntries(
        Object.entries(supportedHooks).filter(([name]) => name !== missingHook),
      );

      // When
      const result = await preflightHandoffCapabilities({
        client: supportedClient,
        eventTypes: HANDOFF_EVENT_TYPES,
        fileSystem: nodeCapabilityFileSystem,
        handoffDirectory: directory,
        hooks,
      });

      // Then
      expect(result.status).toBe("disabled");
      expect(result.diagnostics).toEqual([
        { code: "runtime-capability-missing", capability: `hook.${missingHook}` },
      ]);
    },
  );

  it("disables persistence when a required generic event is unavailable", async () => {
    // Given
    const directory = await createFixtureDirectory();
    const eventTypes = HANDOFF_EVENT_TYPES.filter((eventType) => eventType !== "session.error");

    // When
    const result = await preflightHandoffCapabilities({
      client: supportedClient,
      eventTypes,
      fileSystem: nodeCapabilityFileSystem,
      handoffDirectory: directory,
      hooks: supportedHooks,
    });

    // Then
    expect(result).toEqual({
      diagnostics: [{ code: "runtime-capability-missing", capability: "event.session.error" }],
      status: "disabled",
    });
  });

  it.each(["ensureDirectory", "exclusiveCreate", "replace", "readText", "remove"] as const)(
    "fails closed with redacted diagnostics when %s is indeterminate",
    async (operation) => {
      // Given
      const directory = await createFixtureDirectory();
      const secret = `secret-${operation}-${directory}`;

      // When
      const result = await preflightHandoffCapabilities({
        client: supportedClient,
        eventTypes: HANDOFF_EVENT_TYPES,
        fileSystem: withFailure(operation, secret),
        handoffDirectory: directory,
        hooks: supportedHooks,
      });

      // Then
      expect(result.status).toBe("disabled");
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(directory);
    },
  );

  it.each(["replace", "readText"] as const)(
    "preserves an existing checkpoint when the %s probe fails",
    async (operation) => {
      // Given
      const directory = await createFixtureDirectory();
      const checkpointPath = join(directory, "BACKTO.json");
      const priorCheckpoint = "prior-valid-checkpoint";
      await writeFile(checkpointPath, priorCheckpoint, "utf8");

      // When
      const result = await preflightHandoffCapabilities({
        client: supportedClient,
        eventTypes: HANDOFF_EVENT_TYPES,
        fileSystem: withFailure(operation, "private failure"),
        handoffDirectory: directory,
        hooks: supportedHooks,
      });

      // Then
      expect(result.status).toBe("disabled");
      await expect(readFile(checkpointPath, "utf8")).resolves.toBe(priorCheckpoint);
    },
  );
});
