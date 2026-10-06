import { describe, expect, it } from 'vitest';
import { LogBuffer } from '../src/admin/log-buffer.js';

describe('LogBuffer', () => {
  it('keeps the newest lines up to its capacity', () => {
    const buffer = new LogBuffer(3);
    for (let index = 1; index <= 5; index += 1) buffer.push('info', `line ${index}`);
    expect(buffer.list().map((entry) => entry.text)).toEqual(['line 3', 'line 4', 'line 5']);
    expect(buffer.list(4).map((entry) => entry.text)).toEqual(['line 5']);
  });

  it('redacts secrets before keeping a line', () => {
    const buffer = new LogBuffer();
    buffer.push('error', 'failed with Authorization: Bot abc.def.ghi and token=xyz');
    expect(buffer.list()[0]!.text).not.toMatch(/abc\.def|xyz/);
  });

  it('tees console output to subscribers and restores the console', () => {
    const written: string[] = [];
    const target = {
      log: (...values: unknown[]) => { written.push(values.join(' ')); },
      info: (...values: unknown[]) => { written.push(values.join(' ')); },
      warn: (...values: unknown[]) => { written.push(values.join(' ')); },
      error: (...values: unknown[]) => { written.push(values.join(' ')); },
    };
    const original = target.error;
    const buffer = new LogBuffer();
    const seen: string[] = [];
    buffer.subscribe((entry) => seen.push(`${entry.level}:${entry.text}`));
    buffer.install(target);
    target.error('boom', 42);
    target.log('ok');
    expect(written).toEqual(['boom 42', 'ok']);
    expect(seen).toEqual(['error:boom 42', 'info:ok']);
    buffer.uninstall();
    expect(target.error).toBe(original);
    target.error('after');
    expect(buffer.list()).toHaveLength(2);
  });
});
