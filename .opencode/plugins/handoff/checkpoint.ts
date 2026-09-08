import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { GitState } from "./git-state.js";
import {
  parseHandoffJson,
  parseHandoffState,
  type HandoffState,
} from "./schema.js";
import type {
  BaselineCheckpointCandidate,
  CheckpointCandidate,
  SessionReducerState,
} from "./session-state.js";
import { boundSafeRelativePaths } from './redaction.js';

const RECOVERY_LIMITATION = "Events before plugin activation are unavailable";

export const createStateId = (): string => `state-${randomUUID()}`;

export const worktreeLockHash = (gitState: GitState): string =>
  createHash("sha256")
    .update(`${gitState.worktreePath}\0${gitState.commonDirHash}`)
    .digest("hex");

export async function existingRevision(
  directory: string,
  gitState: GitState,
): Promise<number> {
  try {
    const existing = parseHandoffJson(await readFile(join(directory, "BACKTO.json"), "utf8"));
    return existing.worktree.worktreePath === gitState.worktreePath
      && existing.worktree.commonDirHash === gitState.commonDirHash
      ? existing.revision
      : 0;
  } catch (error) {
    if (error instanceof Error) return 0;
    return 0;
  }
}

type CheckpointSource = BaselineCheckpointCandidate | CheckpointCandidate;

function sourceFromReducer(state: SessionReducerState, sessionId?: string): CheckpointSource | undefined {
  if (sessionId !== undefined) return state.sessions[sessionId] ?? state.baseline;
  const candidates = Object.values(state.sessions).sort((left, right) => right.eventSequence - left.eventSequence);
  return candidates[0] ?? state.baseline;
}

export function checkpointFromReducer(input: {
  readonly reducer: SessionReducerState;
  readonly sessionId?: string;
  readonly gitState: GitState;
  readonly revisionBase: number;
  readonly stateId: string;
  readonly capturedAt: string;
}): HandoffState | undefined {
  const source = sourceFromReducer(input.reducer, input.sessionId);
  if (source === undefined) return undefined;
  const sessionSource = "sessionId" in source ? source : undefined;
  const changedPaths = boundSafeRelativePaths([
    ...source.changedPaths,
    ...input.gitState.changedPaths,
  ]);
  const gitRedaction = input.gitState.changedPathRedaction ?? { paths: 0, truncated: 0 };
  return parseHandoffState({
    schemaVersion: 1,
    stateId: input.stateId,
    revision: input.revisionBase + input.reducer.revision,
    capturedAt: input.capturedAt,
    status: source.status,
    worktree: {
      worktreePath: input.gitState.worktreePath,
      commonDirHash: input.gitState.commonDirHash,
      branch: input.gitState.branch,
      head: input.gitState.head,
      dirtyFingerprint: input.gitState.dirtyFingerprint,
    },
    ...(sessionSource === undefined ? {} : { sessionId: sessionSource.sessionId }),
    eventSequence: input.reducer.eventSequence,
    activeTask: source.activeTask,
    todos: source.todos,
    changedPaths: changedPaths.paths,
    verification: source.verification,
    messageIds: source.messageIds,
    tokens: source.tokens,
    eventOutcomes: source.outcomes,
    processDiagnostics: input.reducer.diagnostics,
    ...(sessionSource?.failure === undefined ? {} : { failure: sessionSource.failure }),
    redaction: {
      ...source.redaction,
      paths: source.redaction.paths + gitRedaction.paths + changedPaths.rejected,
      truncated: source.redaction.truncated + gitRedaction.truncated + changedPaths.truncated,
    },
    uncertainty: {
      flags: source.uncertainty,
      limitations: [RECOVERY_LIMITATION],
    },
  });
}
