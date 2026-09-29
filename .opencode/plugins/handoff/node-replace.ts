import { rename } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
type Dependencies = { platform: string; rename: (source: string, target: string) => Promise<void>; wait: (ms: number) => Promise<unknown> };
export async function replaceFile(source: string, target: string, dependencies: Dependencies = { platform: process.platform, rename, wait: setTimeout }): Promise<void> {
  // Keep replacement atomic: never unlink the existing authority to work around a sharing violation.
  for (let attempt = 0; ; attempt++) {
    try { await dependencies.rename(source, target); return; }
    catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (dependencies.platform !== 'win32' || attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(String(code))) throw error;
      await dependencies.wait(20 * 2 ** attempt);
    }
  }
}
