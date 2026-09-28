
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { validateReleaseEvidence } from './release-gate-core.mjs';

const evidencePath = process.argv[2];
if (!evidencePath) throw new Error('Provide a completed release evidence JSON file');
const absoluteEvidencePath = resolve(evidencePath);
const evidence = JSON.parse(await readFile(absoluteEvidencePath, 'utf8'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await validateReleaseEvidence(evidence, {
  commit: head,
  evidenceDirectory: dirname(absoluteEvidencePath),
});
console.log(`Release evidence and legal links verified for ${head}`);
