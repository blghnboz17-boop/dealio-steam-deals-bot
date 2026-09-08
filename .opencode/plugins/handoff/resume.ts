import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  validateGitState,
  type GitState,
  type GitStateMismatch,
} from './git-state.js';
import {
  parseHandoffJson,
  type FailureSummary,
  type HandoffState,
  type TodoSummary,
  type VerificationResult,
} from './schema.js';
import { isContainedEvidencePath } from './path-containment.js';

export const AUTHORITATIVE_HANDOFF_PATH = '.omo/handoff/BACKTO.json' as const;
export const GENERATED_HANDOFF_PATH = '.omo/handoff/BACKTO.md' as const;

export type ResumeReaders = {
  readonly readAuthoritativeJson: () => Promise<string>;
  readonly readGeneratedMarkdown: () => Promise<string>;
  readonly evidencePathExists: (path: string) => Promise<boolean>;
};

export type ResumeValidationInput = {
  readonly readers: ResumeReaders;
  readonly collectCurrentGitState: () => Promise<GitState>;
};

type ResumeCheckpointStatus = 'active' | 'blocked';
type PassiveCheckpointStatus = 'baseline' | 'idle' | 'complete';

export type SafeResumeCheckpoint = {
  readonly stateId: string;
  readonly revision: number;
  readonly checkpointStatus: ResumeCheckpointStatus;
  readonly sessionId?: string;
  readonly activeTask: string;
  readonly unfinishedTodos: readonly TodoSummary[];
  readonly changedPaths: readonly string[];
  readonly verification: readonly VerificationResult[];
  readonly failure?: FailureSummary;
};

export type ResumeValidation =
  | { readonly status: 'safe-to-resume'; readonly checkpoint: SafeResumeCheckpoint }
  | {
      readonly status: 'no-resume';
      readonly checkpoint: {
        readonly stateId: string;
        readonly revision: number;
        readonly checkpointStatus: PassiveCheckpointStatus;
      };
    }
  | {
      readonly status: 'unsafe-to-resume';
      readonly reason: 'repository-mismatch';
      readonly mismatches: readonly GitStateMismatch[];
    }
  | {
      readonly status: 'unsafe-to-resume';
      readonly reason: 'evidence-missing';
      readonly evidencePaths: readonly string[];
    }
  | {
      readonly status: 'unsafe-to-resume';
      readonly reason:
        | 'checkpoint-conflict'
        | 'invalid-authority'
        | 'revision-changed'
        | 'validation-unavailable';
    }

type AuthorityParseResult =
  | { readonly status: 'parsed'; readonly state: HandoffState }
  | { readonly status: 'invalid' };

class UnexpectedResumeStatusError extends Error {
  readonly name = 'UnexpectedResumeStatusError';
}

function assertNever(value: never): never {
  throw new UnexpectedResumeStatusError(`Unexpected resume status: ${String(value)}`);
}

function parseAuthority(serialized: string): AuthorityParseResult {
  try {
    return { status: 'parsed', state: parseHandoffJson(serialized) };
  } catch (error) {
    if (error instanceof Error) return { status: 'invalid' };
    throw error;
  }
}

function classifyState(state: HandoffState): ResumeCheckpointStatus | ResumeValidation {
  switch (state.status) {
    case 'active':
    case 'blocked':
      return state.status;
    case 'baseline':
    case 'idle':
    case 'complete':
      return {
        status: 'no-resume',
        checkpoint: {
          stateId: state.stateId,
          revision: state.revision,
          checkpointStatus: state.status,
        },
      };
    case 'conflict':
    case 'unsafe-to-resume':
      return { status: 'unsafe-to-resume', reason: 'checkpoint-conflict' };
    default:
      return assertNever(state.status);
  }
}

function evidencePaths(state: HandoffState): readonly string[] {
  return [...new Set(state.todos.flatMap((todo) => todo.evidencePaths))].sort();
}

async function findMissingEvidence(
  readers: ResumeReaders,
  paths: readonly string[],
): Promise<readonly string[]> {
  const existence = await Promise.all(paths.map(async (path) => ({
    path,
    exists: await readers.evidencePathExists(path),
  })));
  return existence.filter((entry) => !entry.exists).map((entry) => entry.path);
}

function safeCheckpoint(state: HandoffState, checkpointStatus: ResumeCheckpointStatus): SafeResumeCheckpoint {
  return {
    stateId: state.stateId,
    revision: state.revision,
    checkpointStatus,
    ...(state.sessionId === undefined ? {} : { sessionId: state.sessionId }),
    activeTask: state.activeTask,
    unfinishedTodos: state.todos.filter((todo) =>
      todo.status === 'pending' || todo.status === 'in_progress'),
    changedPaths: state.changedPaths,
    verification: state.verification,
    ...(state.failure === undefined ? {} : { failure: state.failure }),
  };
}

async function validateParsedResume(
  input: ResumeValidationInput,
  serialized: string,
  state: HandoffState,
): Promise<ResumeValidation> {
  const classification = classifyState(state);
  if (typeof classification !== 'string' && classification.status === 'unsafe-to-resume') {
    return classification;
  }

  if (typeof classification === 'string') {
    const currentGitState = await input.collectCurrentGitState();
    const gitValidation = validateGitState(
      { ...state.worktree, changedPaths: state.changedPaths },
      currentGitState,
    );
    if (gitValidation.status === 'unsafe-to-resume') {
      return {
        status: 'unsafe-to-resume',
        reason: 'repository-mismatch',
        mismatches: gitValidation.mismatches,
      };
    }

    const missingEvidence = await findMissingEvidence(input.readers, evidencePaths(state));
    if (missingEvidence.length !== 0) {
      return { status: 'unsafe-to-resume', reason: 'evidence-missing', evidencePaths: missingEvidence };
    }
  }
  const finalSerialized = await input.readers.readAuthoritativeJson();
  const finalAuthority = parseAuthority(finalSerialized);
  if (finalAuthority.status === 'invalid') {
    return { status: 'unsafe-to-resume', reason: 'invalid-authority' };
  }
  if (
    finalAuthority.state.stateId !== state.stateId ||
    finalAuthority.state.revision !== state.revision ||
    JSON.stringify(finalAuthority.state) !== JSON.stringify(state) ||
    finalSerialized !== serialized
  ) {
    return { status: 'unsafe-to-resume', reason: 'revision-changed' };
  }
  if (typeof classification !== 'string') return classification;
  return { status: 'safe-to-resume', checkpoint: safeCheckpoint(state, classification) };
}

export async function validateResume(input: ResumeValidationInput): Promise<ResumeValidation> {
  try {
    const serialized = await input.readers.readAuthoritativeJson();
    const authority = parseAuthority(serialized);
    if (authority.status === 'invalid') {
      return { status: 'unsafe-to-resume', reason: 'invalid-authority' };
    }
    return await validateParsedResume(input, serialized, authority.state);
  } catch (error) {
    if (error instanceof Error) {
      return { status: 'unsafe-to-resume', reason: 'validation-unavailable' };
    }
    return { status: 'unsafe-to-resume', reason: 'validation-unavailable' };
  }
}

export function createNodeResumeReaders(worktreeRoot: string): ResumeReaders {
  return {
    readAuthoritativeJson: async () => readFile(join(worktreeRoot, AUTHORITATIVE_HANDOFF_PATH), 'utf8'),
    readGeneratedMarkdown: async () => readFile(join(worktreeRoot, GENERATED_HANDOFF_PATH), 'utf8'),
    evidencePathExists: async (path) => isContainedEvidencePath(worktreeRoot, path),
  };
}
