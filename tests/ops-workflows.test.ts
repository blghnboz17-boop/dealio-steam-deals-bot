import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = join('.github', 'workflows');
const workflows = readdirSync(directory).filter((file) => /\.ya?ml$/.test(file))
  .map((file) => ({ file, text: readFileSync(join(directory, file), 'utf8').replace(/\r\n/g, '\n') }));

describe('GitHub Actions workflows', () => {
  it('finds the workflows', () => {
    expect(workflows.map(({ file }) => file)).toEqual(expect.arrayContaining(['ci.yml', 'offsite-backup.yml', 'restore-rehearsal.yml']));
  });

  it.each(workflows)('$file pins every action to a full commit SHA', ({ text }) => {
    const uses = [...text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((match) => match[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action, action).toMatch(/^[\w.-]+\/[\w.\/-]+@[0-9a-f]{40}$/);
  });

  it.each(workflows)('$file declares least-privilege permissions and no untrusted triggers', ({ text }) => {
    expect(text).toMatch(/^permissions:\n(?: {2}\w+: (?:read|none)\n)+/m);
    expect(text).not.toMatch(/^\s+[\w-]+: write\s*$/m);
    expect(text).not.toContain('pull_request_target');
    expect(text).not.toContain('workflow_run');
  });

  it.each(workflows)('$file never expands event data or secrets inside a shell script', ({ text }) => {
    // Expressions are passed through env: and quoted in the script instead.
    const scripts = [...text.matchAll(/^(\s*)(?:-\s*)?run: (\|\n(?:\1\s+.*\n|\n)*|.*)/gm)].map((match) => match[2]!);
    for (const script of scripts) expect(script, script).not.toContain('${{');
  });

  it.each(workflows)('$file does not leave the job token in the checkout or run unbounded', ({ text }) => {
    for (const checkout of text.matchAll(/uses: actions\/checkout@\S+.*\n((?:\s+.*\n)*)/g)) {
      expect(checkout[1]).toContain('persist-credentials: false');
    }
    expect(text).toMatch(/timeout-minutes: \d+/);
  });
});
