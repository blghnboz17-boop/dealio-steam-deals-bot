import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GitState } from '../.opencode/plugins/handoff/git-state.js';
import { renderHandoffMarkdown } from '../.opencode/plugins/handoff/render.js';
import {
  validateResume,
  createNodeResumeReaders,
  type ResumeReaders,
} from '../.opencode/plugins/handoff/resume.js';
import { parseHandoffState } from '../.opencode/plugins/handoff/schema.js';

const gitState: GitState = {
  worktreePath: '/mnt/c/work/dealio',
  commonDirHash: 'a'.repeat(64),
  branch: 'main',
  head: 'b'.repeat(40),
  dirtyFingerprint: 'c'.repeat(64),
  changedPaths: ['src/index.ts'],
};

const activeState = parseHandoffState({
  schemaVersion: 1,
  stateId: 'state-resume-0001',
  revision: 8,
  capturedAt: '2026-08-31T18:00:00.000Z',
  status: 'active',
  worktree: {
    worktreePath: gitState.worktreePath,
    commonDirHash: gitState.commonDirHash,
    branch: gitState.branch,
    head: gitState.head,
    dirtyFingerprint: gitState.dirtyFingerprint,
  },
  sessionId: 'session-resume-1',
  eventSequence: 24,
  activeTask: 'Continue durable handoff validation',
  todos: [
    {
      id: 'todo-done',
      summary: 'Define the schema',
      status: 'completed',
      evidencePaths: ['tests/opencode-handoff-schema.test.ts'],
    },
    {
      id: 'todo-open',
      summary: 'Validate fresh-session resume',
      status: 'in_progress',
      evidencePaths: ['tests/opencode-handoff-resume.test.ts'],
    },
  ],
  changedPaths: ['.opencode/plugins/handoff/resume.ts'],
  verification: [{ command: 'handoff-typecheck', exitCode: 0 }],
  redaction: { fields: 0, values: 0, paths: 0, truncated: 0 },
  uncertainty: { flags: [], limitations: [] },
});

type ReaderOverrides = {
  readonly jsonReads?: readonly string[];
  readonly markdown?: string;
  readonly missingEvidence?: string;
};

function createReaders(overrides: ReaderOverrides = {}): ResumeReaders {
  const jsonReads = [...(overrides.jsonReads ?? [JSON.stringify(activeState)])];
  const finalJson = jsonReads.at(-1) ?? JSON.stringify(activeState);
  return {
    readAuthoritativeJson: vi.fn(async () => jsonReads.shift() ?? finalJson),
    readGeneratedMarkdown: vi.fn(async () => overrides.markdown ?? renderHandoffMarkdown(activeState)),
    evidencePathExists: vi.fn(async (path) => path !== overrides.missingEvidence),
  };
}

function serializeState(fields: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ ...activeState, ...fields });
}

describe('fresh-session resume validation', () => {
  it('returns exact resume metadata when an active checkpoint matches the repository and evidence', async () => {
    // Given
    const readers = createReaders();
    const collectCurrentGitState = vi.fn(async () => gitState);

    // When
    const result = await validateResume({ readers, collectCurrentGitState });

    // Then
    expect(result).toEqual({
      status: 'safe-to-resume',
      checkpoint: {
        stateId: 'state-resume-0001',
        revision: 8,
        checkpointStatus: 'active',
        sessionId: 'session-resume-1',
        activeTask: 'Continue durable handoff validation',
        unfinishedTodos: [{
          id: 'todo-open',
          summary: 'Validate fresh-session resume',
          status: 'in_progress',
          evidencePaths: ['tests/opencode-handoff-resume.test.ts'],
        }],
        changedPaths: ['.opencode/plugins/handoff/resume.ts'],
        verification: [{ command: 'handoff-typecheck', exitCode: 0 }],
      },
    });
    expect(collectCurrentGitState).toHaveBeenCalledOnce();
    expect(readers.readAuthoritativeJson).toHaveBeenCalledTimes(2);
  });

  it('preserves a quota-like block as safe resume metadata', async () => {
    // Given
    const blocked = parseHandoffState({
      ...activeState,
      status: 'blocked',
      failure: { kind: 'quota-like', code: 'provider-limit', summary: 'Provider refused continuation' },
    });
    const serialized = JSON.stringify(blocked);
    const readers = createReaders({ jsonReads: [serialized], markdown: renderHandoffMarkdown(blocked) });

    // When
    const result = await validateResume({ readers, collectCurrentGitState: async () => gitState });

    // Then
    expect(result.status).toBe('safe-to-resume');
    if (result.status === 'safe-to-resume') {
      expect(result.checkpoint.checkpointStatus).toBe('blocked');
      expect(result.checkpoint.failure).toEqual(blocked.failure);
    }
  });

  it.each(['baseline', 'idle', 'complete'] as const)(
    'keeps a %s checkpoint readable without forcing continuation',
    async (status) => {
      // Given
      const settled = parseHandoffState({
        ...activeState,
        status,
        todos: status === 'complete' ? [] : activeState.todos,
        verification: status === 'complete' ? [{ command: 'project-tests', exitCode: 0 }] : activeState.verification,
      });
      const serialized = JSON.stringify(settled);

      // When
      const result = await validateResume({
        readers: createReaders({ jsonReads: [serialized], markdown: renderHandoffMarkdown(settled) }),
        collectCurrentGitState: vi.fn(async () => gitState),
      });

      // Then
      expect(result).toEqual({
        status: 'no-resume',
        checkpoint: { stateId: settled.stateId, revision: settled.revision, checkpointStatus: status },
      });
    },
  );

  it.each([
    ['corrupt JSON', ['{"schemaVersion":1'], 'invalid-authority'],
    ['schema version', [serializeState({ schemaVersion: 2 })], 'invalid-authority'],
    ['conflict status', [serializeState({ status: 'conflict' })], 'checkpoint-conflict'],
    ['unsafe status', [serializeState({ status: 'unsafe-to-resume' })], 'checkpoint-conflict'],
    [
      'stale revision',
      [JSON.stringify(activeState), serializeState({ revision: activeState.revision - 1 })],
      'revision-changed',
    ],
  ] as const)('fails closed for %s', async (_caseName, jsonReads, reason) => {
    // Given / When
    const result = await validateResume({
      readers: createReaders({ jsonReads }),
      collectCurrentGitState: async () => gitState,
    });

    // Then
    expect(result).toEqual({ status: 'unsafe-to-resume', reason });
  });

  it.each([
    ['second worktree', { worktreePath: '/mnt/c/work/linked' }, ['worktree-path']],
    ['common directory drift', { commonDirHash: 'f'.repeat(64) }, ['common-dir']],
    ['branch drift', { branch: 'other' }, ['branch']],
    ['HEAD drift', { head: 'd'.repeat(40) }, ['head']],
    ['dirty drift', { dirtyFingerprint: 'e'.repeat(64) }, ['dirty-fingerprint']],
  ] as const)('fails closed for %s', async (_caseName, drift, mismatches) => {
    // Given / When
    const result = await validateResume({
      readers: createReaders(),
      collectCurrentGitState: async () => ({ ...gitState, ...drift }),
    });

    // Then
    expect(result).toEqual({ status: 'unsafe-to-resume', reason: 'repository-mismatch', mismatches });
  });

  it('fails closed when recorded evidence is absent', async () => {
    // Given / When
    const result = await validateResume({
      readers: createReaders({ missingEvidence: 'tests/opencode-handoff-resume.test.ts' }),
      collectCurrentGitState: async () => gitState,
    });

    // Then
    expect(result).toEqual({
      status: 'unsafe-to-resume',
      reason: 'evidence-missing',
      evidencePaths: ['tests/opencode-handoff-resume.test.ts'],
    });
  });

  it('rejects evidence reached through a symlinked ancestor outside the canonical worktree', async () => {
    // Given
    const fixtureParent = join(process.cwd(), '.omo', 'evidence', 'durable-opencode-handoff');
    await mkdir(fixtureParent, { recursive: true });
    const worktree = await mkdtemp(join(fixtureParent, 'security-evidence-worktree-'));
    const external = await mkdtemp(join(dirname(worktree), 'security-evidence-external-'));
    await writeFile(join(external, 'proof.txt'), 'bounded fixture\n', 'utf8');
    await symlink(external, join(worktree, 'evidence-link'), 'junction');

    try {
      // When
      const exists = await createNodeResumeReaders(worktree).evidencePathExists('evidence-link/proof.txt');

      // Then
      expect(exists).toBe(false);
    } finally {
      await rm(worktree, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

  it('tolerates stale derived Markdown while authoritative JSON remains stable', async () => {
    // Given
    const conflictingMarkdown = renderHandoffMarkdown(parseHandoffState({ ...activeState, revision: 99 }));

    // When
    const result = await validateResume({
      readers: createReaders({ markdown: conflictingMarkdown }),
      collectCurrentGitState: async () => gitState,
    });

    // Then
    expect(result.status).toBe('safe-to-resume');
  });

  it('contains failures and performs no repository mutation', async () => {
    // Given
    const readAuthoritativeJson = vi.fn(async () => {
      throw new Error('synthetic read failure');
    });
    const readers: ResumeReaders = {
      readAuthoritativeJson,
      readGeneratedMarkdown: vi.fn(async () => ''),
      evidencePathExists: vi.fn(async () => false),
    };

    // When
    const result = await validateResume({ readers, collectCurrentGitState: async () => gitState });

    // Then
    expect(result).toEqual({ status: 'unsafe-to-resume', reason: 'validation-unavailable' });
    expect(readAuthoritativeJson).toHaveBeenCalledOnce();
    expect(readers.readGeneratedMarkdown).not.toHaveBeenCalled();
    expect(readers.evidencePathExists).not.toHaveBeenCalled();
  });
});

describe('root continuation policy structure', () => {
  it('preserves project contracts and declares machine-facing continuation tokens', async () => {
    // Given / When
    const policy = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
    const sectionNames = [...policy.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    const inlineTokens = new Set([...policy.matchAll(/`([^`]+)`/g)].map((match) => match[1]));

    // Then
    expect(sectionNames).toEqual(expect.arrayContaining(['Goal', 'Rules', 'First Version Scope', 'Work Continuation']));
    expect([...inlineTokens]).toEqual(expect.arrayContaining([
      'BACKTO.json',
      'BACKTO.md',
      'active',
      'blocked',
      'baseline',
      'idle',
      'complete',
      'unsafe-to-resume',
      'handoff_complete',
      'node:sqlite',
    ]));
    expect(policy).toMatch(/Steam/);
    expect(policy).toMatch(/Discord/);
  });
});
