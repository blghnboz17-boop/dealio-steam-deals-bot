import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import type { Event } from "@opencode-ai/sdk";

export const HANDOFF_EVENT_TYPES = [
  "message.updated",
  "session.compacted",
  "session.error",
  "session.idle",
  "todo.updated",
] as const satisfies readonly Event["type"][];

export const HANDOFF_HOOK_NAMES = [
  "chat.message",
  "dispose",
  "event",
  "tool.execute.after",
  "tool.execute.before",
] as const;

const SESSION_METHOD_NAMES = ["todo", "messages", "diff"] as const;

type RuntimeCapabilityName =
  | `client.session.${(typeof SESSION_METHOD_NAMES)[number]}`
  | `event.${(typeof HANDOFF_EVENT_TYPES)[number]}`
  | `hook.${(typeof HANDOFF_HOOK_NAMES)[number]}`;

export type CapabilityDiagnostic =
  | {
      readonly code: "runtime-capability-missing";
      readonly capability: RuntimeCapabilityName;
    }
  | {
      readonly code: "filesystem-probe-indeterminate";
      readonly operation: "cleanup" | "directory" | "exclusive-create" | "replace-readback";
    };

export type CapabilityPreflightResult =
  | { readonly status: "enabled"; readonly diagnostics: readonly [] }
  | {
      readonly status: "disabled";
      readonly diagnostics: readonly CapabilityDiagnostic[];
    };

export type CapabilityFileSystem = {
  readonly ensureDirectory: (path: string) => Promise<void>;
  readonly exclusiveCreate: (path: string, contents: string) => Promise<void>;
  readonly readText: (path: string) => Promise<string>;
  readonly remove: (path: string) => Promise<void>;
  readonly replace: (source: string, target: string) => Promise<void>;
};

export type CapabilityPreflightInput = {
  readonly client: unknown;
  readonly eventTypes: readonly string[];
  readonly fileSystem: CapabilityFileSystem;
  readonly handoffDirectory: string;
  readonly hooks: unknown;
};

export const nodeCapabilityFileSystem: CapabilityFileSystem = {
  ensureDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  exclusiveCreate: async (path, contents) => {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
    } finally {
      await handle.close();
    }
  },
  readText: async (path) => readFile(path, "utf8"),
  remove: async (path) => {
    await rm(path, { force: true });
  },
  replace: async (source, target) => {
    await rename(source, target);
  },
};

type PropertyBag = { readonly [name: string]: unknown };

function isPropertyBag(value: unknown): value is PropertyBag {
  return typeof value === "object" && value !== null;
}

function hasFunction(value: unknown, name: string): boolean {
  return isPropertyBag(value) && typeof value[name] === "function";
}

function findMissingRuntimeCapability(
  input: CapabilityPreflightInput,
): RuntimeCapabilityName | undefined {
  if (!isPropertyBag(input.client)) {
    return "client.session.todo";
  }

  for (const methodName of SESSION_METHOD_NAMES) {
    if (!hasFunction(input.client["session"], methodName)) {
      return `client.session.${methodName}`;
    }
  }
  for (const hookName of HANDOFF_HOOK_NAMES) {
    if (!hasFunction(input.hooks, hookName)) {
      return `hook.${hookName}`;
    }
  }
  for (const eventType of HANDOFF_EVENT_TYPES) {
    if (!input.eventTypes.includes(eventType)) {
      return `event.${eventType}`;
    }
  }
  return undefined;
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

async function exclusiveCreateIsSupported(
  fileSystem: CapabilityFileSystem,
  path: string,
): Promise<boolean> {
  await fileSystem.exclusiveCreate(path, "exclusive-original");
  try {
    await fileSystem.exclusiveCreate(path, "exclusive-overwrite");
    return false;
  } catch (error) {
    return isAlreadyExistsError(error);
  }
}

async function runFileSystemProbe(
  fileSystem: CapabilityFileSystem,
  exclusivePath: string,
  targetPath: string,
  replacementPath: string,
): Promise<"supported" | "exclusive-create" | "replace-readback"> {
  try {
    if (!(await exclusiveCreateIsSupported(fileSystem, exclusivePath))) {
      return "exclusive-create";
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      return "exclusive-create";
    }
    return "exclusive-create";
  }
  try {
    await fileSystem.exclusiveCreate(targetPath, "replace-original");
    await fileSystem.exclusiveCreate(replacementPath, "replace-new");
    await fileSystem.replace(replacementPath, targetPath);
    return (await fileSystem.readText(targetPath)) === "replace-new"
      ? "supported"
      : "replace-readback";
  } catch (error) {
    if (!(error instanceof Error)) {
      return "replace-readback";
    }
    return "replace-readback";
  }
}

export async function preflightHandoffCapabilities(
  input: CapabilityPreflightInput,
): Promise<CapabilityPreflightResult> {
  const missingCapability = findMissingRuntimeCapability(input);
  if (missingCapability !== undefined) {
    return {
      diagnostics: [{ code: "runtime-capability-missing", capability: missingCapability }],
      status: "disabled",
    };
  }

  try {
    await input.fileSystem.ensureDirectory(input.handoffDirectory);
  } catch (error) {
    if (!(error instanceof Error)) {
      return {
        diagnostics: [{ code: "filesystem-probe-indeterminate", operation: "directory" }],
        status: "disabled",
      };
    }
    return {
      diagnostics: [{ code: "filesystem-probe-indeterminate", operation: "directory" }],
      status: "disabled",
    };
  }
  const nonce = randomUUID();
  const exclusivePath = join(input.handoffDirectory, `.capability-${nonce}.exclusive`);
  const targetPath = join(input.handoffDirectory, `.capability-${nonce}.target`);
  const replacementPath = join(input.handoffDirectory, `.capability-${nonce}.replacement`);
  const probeResult = await runFileSystemProbe(
    input.fileSystem,
    exclusivePath,
    targetPath,
    replacementPath,
  );
  const cleanupResults = await Promise.allSettled(
    [exclusivePath, targetPath, replacementPath].map(input.fileSystem.remove),
  );
  if (cleanupResults.some((result) => result.status === "rejected")) {
    return {
      diagnostics: [{ code: "filesystem-probe-indeterminate", operation: "cleanup" }],
      status: "disabled",
    };
  }
  if (probeResult !== "supported") {
    return {
      diagnostics: [{ code: "filesystem-probe-indeterminate", operation: probeResult }],
      status: "disabled",
    };
  }
  return { diagnostics: [], status: "enabled" };
}
