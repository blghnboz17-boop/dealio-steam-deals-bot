import { describe, expect, it, vi } from 'vitest';
import { replaceFile } from '../.opencode/plugins/handoff/node-replace.js';

describe('atomic Windows handoff replacement', () => {
  it('retries transient sharing failures with a bounded delay and the same paths', async () => {
    const rename = vi.fn().mockRejectedValueOnce({ code: 'EPERM' }).mockRejectedValueOnce({ code: 'EBUSY' }).mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    await replaceFile('staged', 'authority', { platform: 'win32', rename, wait });
    expect(rename.mock.calls).toEqual([['staged', 'authority'], ['staged', 'authority'], ['staged', 'authority']]);
    expect(wait.mock.calls).toEqual([[20], [40]]);
  });
  it('propagates persistent denial after at most five attempts', async () => {
    const error = { code: 'EACCES' };
    const rename = vi.fn().mockRejectedValue(error);
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(replaceFile('staged', 'authority', { platform: 'win32', rename, wait })).rejects.toBe(error);
    expect(rename).toHaveBeenCalledTimes(5);
    expect(wait.mock.calls).toEqual([[20], [40], [80], [160]]);
  });
  it.each([['linux', 'EPERM'], ['win32', 'ENOENT'], ['win32', 'EXDEV']])('does not retry %s %s', async (platform, code) => {
    const error = { code }; const rename = vi.fn().mockRejectedValue(error); const wait = vi.fn();
    await expect(replaceFile('staged', 'authority', { platform, rename, wait })).rejects.toBe(error);
    expect(rename).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  });
});
