import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const requiredGates = [
  'testBotDesktop', 'testBotMobile', 'restoreRehearsal',
  'independentAlarm', 'cleanInstall', 'azureCreditVerified',
];

export async function validateReleaseEvidence(evidence, {
  commit, evidenceDirectory, fetchPage = fetch,
}) {
  if (!evidence || evidence.commit !== commit) {
    throw new Error('Acceptance evidence must match this exact commit');
  }

  for (const gate of requiredGates) {
    const entry = evidence[gate];
    if (entry?.passed !== true || typeof entry.evidence !== 'string' || !entry.evidence.trim()) {
      throw new Error(`Release gate missing: ${gate}`);
    }
    const recordPath = resolve(evidenceDirectory, entry.evidence);
    let file;
    try {
      file = await stat(recordPath);
    } catch {
      throw new Error(`Release gate evidence file is missing: ${gate}`);
    }
    if (!file.isFile() || file.size === 0) {
      throw new Error(`Release gate evidence file is empty or invalid: ${gate}`);
    }
    let record;
    try {
      record = JSON.parse(await readFile(recordPath, 'utf8'));
    } catch {
      throw new Error(`Release gate evidence record is invalid: ${gate}`);
    }
    if (record?.schemaVersion !== 1 || record.gate !== gate || record.commit !== commit
      || record.passed !== true || typeof record.summary !== 'string'
      || !record.summary.trim() || !Number.isFinite(Date.parse(record.checkedAt))
      || !Array.isArray(record.artifacts) || record.artifacts.length === 0) {
      throw new Error(`Release gate evidence record is incomplete or stale: ${gate}`);
    }
    for (const artifact of record.artifacts) {
      if (typeof artifact !== 'string' || !artifact.trim()) {
        throw new Error(`Release gate artifact is invalid: ${gate}`);
      }
      try {
        const artifactFile = await stat(resolve(dirname(recordPath), artifact));
        if (!artifactFile.isFile() || artifactFile.size === 0) {
          throw new Error('Empty artifact');
        }
      } catch {
        throw new Error(`Release gate artifact is missing or empty: ${gate}`);
      }
    }
  }

  for (const key of ['termsUrl', 'privacyUrl', 'supportUrl']) {
    const url = new URL(evidence[key]);
    if (url.protocol !== 'https:') throw new Error(`Public page must use HTTPS: ${key}`);
    const response = await fetchPage(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) {
      throw new Error(`Public page is unavailable: ${key}`);
    }
  }
}
