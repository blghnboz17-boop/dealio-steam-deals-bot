import { tool, type Hooks } from "@opencode-ai/plugin";
import { join } from 'node:path';

import {
  HANDOFF_EVENT_TYPES,
  nodeCapabilityFileSystem,
  preflightHandoffCapabilities,
  type CapabilityFileSystem,
} from "./capabilities.js";
import { loadBootstrapState } from "./bootstrap.js";
import { worktreeLockHash } from "./checkpoint.js";
import type { SessionReadClient } from "./collector.js";
import {
  HandoffController,
  type CompletionEvidence,
} from "./controller.js";
import type { GitState } from "./git-state.js";
import { collectNodeGitState } from "./node-git.js";
import { createHandoffStorage } from "./storage.js";
import { VERIFICATION_COMMAND_IDS } from './durable-values.js';
import { canonicalWorktreeMatches, prepareHandoffDirectory } from './path-containment.js';

const DEFAULT_HANDLER_TIMEOUT_MS = 1_000;
const DEFAULT_DISPOSE_TIMEOUT_MS = 1_000;

export type HandoffPluginInput = {
  readonly client: unknown;
  readonly directory: string;
  readonly worktree: string;
};

export type HandoffPluginDependencies = {
  readonly collectGitState?: () => Promise<GitState>;
  readonly disposeTimeoutMs?: number;
  readonly flush?: () => Promise<void>;
  readonly handlerTimeoutMs?: number;
  readonly eventQueueCapacity?: number;
  readonly now?: () => string;
  readonly capabilityFileSystem?: CapabilityFileSystem;
};

type PropertyBag = { readonly [key: string]: unknown };

function isPropertyBag(value: unknown): value is PropertyBag {
  return typeof value === "object" && value !== null;
}

function isSessionReadClient(value: unknown): value is SessionReadClient {
  if (!isPropertyBag(value) || !isPropertyBag(value["session"])) return false;
  const session = value["session"];
  return typeof session["todo"] === "function"
    && typeof session["messages"] === "function"
    && typeof session["diff"] === "function";
}

function completionTool(
  controller: () => HandoffController | undefined,
  expectedWorktree: () => string | undefined,
) {
  return tool({
    description: "Mark the current validated handoff complete using explicit passing verification evidence.",
    args: {
      verification: tool.schema.array(tool.schema.object({
        command: tool.schema.enum(VERIFICATION_COMMAND_IDS),
        exitCode: tool.schema.number().int().nonnegative(),
      }).strict()).max(20),
    },
    execute: async (args, context) => {
      const active = controller();
      if (active === undefined) return { output: "Handoff persistence is disabled", metadata: { status: "disabled" } };
      const canonicalWorktree = expectedWorktree();
      if (canonicalWorktree === undefined || !(await canonicalWorktreeMatches(context.worktree, canonicalWorktree))) return { output: "Handoff completion rejected", metadata: { status: "rejected", reason: "worktree-mismatch" } };
      try {
        const result = await active.complete(context.sessionID, args.verification satisfies CompletionEvidence);
        return result.status === "complete"
          ? { output: "Handoff completed", metadata: { status: "complete" } }
          : { output: "Handoff completion rejected", metadata: { status: "rejected", reason: result.reason } };
      } catch (error) {
        return error instanceof Error
          ? { output: "Handoff completion rejected", metadata: { status: "rejected", reason: "handler-failed" } }
          : { output: "Handoff completion rejected", metadata: { status: "rejected", reason: "handler-failed" } };
      }
    },
  });
}

export async function createHandoffPlugin(
  input: HandoffPluginInput,
  dependencies: HandoffPluginDependencies = {},
): Promise<Hooks> {
  let controller: HandoffController | undefined;
  let canonicalWorktree: string | undefined;
  let storageFlush = async (): Promise<void> => undefined;
  const hooks: Hooks = {
    "chat.message": async (event) => { await controller?.chat(event.sessionID, event.messageID); },
    "tool.execute.before": async (event) => { await controller?.toolBefore(event.sessionID, event.callID, event.tool); },
    "tool.execute.after": async (event) => { await controller?.toolAfter(event.sessionID, event.callID, event.tool); },
    event: async ({ event }) => { await controller?.generic(event); },
    dispose: async () => { await controller?.dispose(dependencies.disposeTimeoutMs ?? DEFAULT_DISPOSE_TIMEOUT_MS, dependencies.flush ?? storageFlush); },
    tool: { handoff_complete: completionTool(() => controller, () => canonicalWorktree) },
  };

  try {
    const collectCurrentGitState = dependencies.collectGitState ?? (() => collectNodeGitState(input.worktree));
    const gitState = await collectCurrentGitState();
    if (!(await canonicalWorktreeMatches(input.worktree, gitState.worktreePath))) return hooks;
    canonicalWorktree = gitState.worktreePath;
    const requestedHandoffDirectory = join(canonicalWorktree, '.omo', 'handoff');
    const bootstrap = await loadBootstrapState({ worktree: canonicalWorktree, handoffDirectory: requestedHandoffDirectory, collectGitState: collectCurrentGitState });
    if (bootstrap.kind === "unsafe") return hooks;
    const handoffDirectory = await prepareHandoffDirectory(canonicalWorktree);
    const preflight = await preflightHandoffCapabilities({
      client: input.client,
      eventTypes: HANDOFF_EVENT_TYPES,
      fileSystem: dependencies.capabilityFileSystem ?? nodeCapabilityFileSystem,
      handoffDirectory,
      hooks,
    });
    if (preflight.status === "disabled" || !isSessionReadClient(input.client)) return hooks;
    const storage = createHandoffStorage({ directory: handoffDirectory, worktreeHash: worktreeLockHash(gitState) });
    storageFlush = () => storage.flush();
    controller = new HandoffController({
      client: input.client,
      directory: canonicalWorktree,
      worktree: canonicalWorktree,
      revisionBase: bootstrap.revisionBase,
      storage,
      collectGitState: collectCurrentGitState,
      now: dependencies.now ?? (() => new Date().toISOString()),
      handlerTimeoutMs: dependencies.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS,
      ...(dependencies.eventQueueCapacity === undefined ? {} : { queueCapacity: dependencies.eventQueueCapacity }),
      ...(bootstrap.kind === "preserved" ? { initialAuthority: bootstrap.authority } : {}),
    });
    if (!(await controller.setup())) controller = undefined;
  } catch (error) {
    if (error instanceof Error) controller = undefined;
    else controller = undefined;
  }
  return hooks;
}
