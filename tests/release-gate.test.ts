import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateReleaseEvidence } from '../scripts/release-gate-core.mjs';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const gates = [
  'testBotDesktop', 'testBotMobile', 'restoreRehearsal',
  'independentAlarm', 'cleanInstall', 'azureCreditVerified',
] as const;

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dealio-release-gate-'));
  directories.push(directory);
  const evidence = Object.fromEntries(gates.map((gate) => [gate, { passed: true, evidence: `${gate}.json` }]));
  for (const gate of gates) {
    await writeFile(join(directory, `${gate}.txt`), `${gate} observed\n`);
    await writeFile(join(directory, `${gate}.json`), JSON.stringify({
      schemaVersion: 1, gate, commit: 'test-commit', passed: true,
      checkedAt: '2026-09-28T12:00:00.000Z', summary: `${gate} checked`,
      artifacts: [`${gate}.txt`],
    }));
  }
  return {
    directory,
    evidence: {
      commit: 'test-commit', ...evidence,
      termsUrl: 'https://example.test/terms', privacyUrl: 'https://example.test/privacy',
      supportUrl: 'https://example.test/help',
    },
    fetchPage: vi.fn(async () => ({ ok: true, headers: { get: () => 'text/html; charset=utf-8' } })),
  };
}

describe('release evidence gate', () => {
  it('rejects a passing checkbox whose evidence file is missing', async () => {
    const { directory, evidence, fetchPage } = await fixture();
    evidence.testBotMobile.evidence = 'missing.json';
    await expect(validateReleaseEvidence(evidence, {
      commit: 'test-commit', evidenceDirectory: directory, fetchPage,
    })).rejects.toThrow(/testBotMobile/);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('rejects an empty evidence file', async () => {
    const { directory, evidence, fetchPage } = await fixture();
    await writeFile(join(directory, evidence.restoreRehearsal.evidence), '');
    await expect(validateReleaseEvidence(evidence, {
      commit: 'test-commit', evidenceDirectory: directory, fetchPage,
    })).rejects.toThrow(/restoreRehearsal/);
  });

  it('rejects evidence from a different commit', async () => {
    const { directory, evidence, fetchPage } = await fixture();
    const recordPath = join(directory, evidence.cleanInstall.evidence);
    await writeFile(recordPath, JSON.stringify({
      schemaVersion: 1, gate: 'cleanInstall', commit: 'older-commit', passed: true,
      checkedAt: '2026-09-28T12:00:00.000Z', summary: 'Checked', artifacts: ['cleanInstall.txt'],
    }));
    await expect(validateReleaseEvidence(evidence, {
      commit: 'test-commit', evidenceDirectory: directory, fetchPage,
    })).rejects.toThrow(/cleanInstall/);
  });

  it('rejects a missing underlying artifact', async () => {
    const { directory, evidence, fetchPage } = await fixture();
    const recordPath = join(directory, evidence.testBotDesktop.evidence);
    await writeFile(recordPath, JSON.stringify({
      schemaVersion: 1, gate: 'testBotDesktop', commit: 'test-commit', passed: true,
      checkedAt: '2026-09-28T12:00:00.000Z', summary: 'Checked', artifacts: ['missing.txt'],
    }));
    await expect(validateReleaseEvidence(evidence, {
      commit: 'test-commit', evidenceDirectory: directory, fetchPage,
    })).rejects.toThrow(/testBotDesktop/);
  });

  it('accepts matching commit, nonempty evidence files, and reachable legal pages', async () => {
    const { directory, evidence, fetchPage } = await fixture();
    await expect(validateReleaseEvidence(evidence, {
      commit: 'test-commit', evidenceDirectory: directory, fetchPage,
    })).resolves.toBeUndefined();
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('rejects an unavailable help page', async () => {
    const { directory, evidence, fetchPage } = await fixture();
    fetchPage.mockImplementation(async (...args: unknown[]) => ({
      ok: String(args[0]) !== evidence.supportUrl,
      headers: { get: () => 'text/html' },
    }));
    await expect(validateReleaseEvidence(evidence, {
      commit: 'test-commit', evidenceDirectory: directory, fetchPage,
    })).rejects.toThrow(/supportUrl/);
  });

  it('rejects a help page without HTTPS', async () => {
    const { directory, evidence, fetchPage } = await fixture();
    evidence.supportUrl = 'http://example.test/help';
    await expect(validateReleaseEvidence(evidence, {
      commit: 'test-commit', evidenceDirectory: directory, fetchPage,
    })).rejects.toThrow(/HTTPS/);
  });
});
