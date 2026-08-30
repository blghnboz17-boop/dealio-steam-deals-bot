import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BotActionConflictError,
  BotController,
  InvalidBotActionError,
  parseBotAction,
  type BotControlChild,
  type BotControlSpawn,
  type BotControlSpawnOptions,
} from '../src/admin/bot-controller.js';

class ChildFake extends EventEmitter implements BotControlChild {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);

  finish(exitCode: number | null = 0): void {
    this.emit('close', exitCode, null);
  }
}

function controllerHarness() {
  const children: ChildFake[] = [];
  const calls: Array<{
    readonly command: string;
    readonly arguments: readonly string[];
    readonly options: BotControlSpawnOptions;
  }> = [];
  const spawn: BotControlSpawn = (command, arguments_, options) => {
    const child = new ChildFake();
    children.push(child);
    calls.push({ command, arguments: arguments_, options });
    return child;
  };
  const times = [
    new Date('2026-08-29T12:00:00.000Z'),
    new Date('2026-08-29T12:00:01.000Z'),
    new Date('2026-08-29T12:00:02.000Z'),
    new Date('2026-08-29T12:00:03.000Z'),
  ];
  let timeIndex = 0;
  const controller = new BotController({
    spawn,
    now: () => times[timeIndex++] ?? new Date('2026-08-29T12:00:04.000Z'),
  });
  return { calls, children, controller };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('BotController', () => {
  it.each([
    ['start', 'Start'],
    ['stop', 'Stop'],
    ['restart', 'Restart'],
  ] as const)('uses exact fixed argv for %s', async (action, scriptAction) => {
    const harness = controllerHarness();

    const completion = harness.controller.execute(action);
    harness.children[0]?.finish();
    await completion;

    expect(harness.calls).toEqual([{
      command: 'powershell.exe',
      arguments: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolve('scripts/bot-control.ps1'),
        '-Action',
        scriptAction,
        '-ProjectRoot',
        resolve('.'),
      ],
      options: {
        cwd: resolve('.'),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    }]);
  });

  it('publishes only generic running and successful snapshots', async () => {
    const harness = controllerHarness();

    const completion = harness.controller.execute('restart');
    expect(harness.controller.snapshot()).toEqual({
      action: 'restart',
      state: 'running',
      startedAt: '2026-08-29T12:00:00.000Z',
    });
    harness.children[0]?.stdout.write('sensitive stdout');
    harness.children[0]?.stderr.write('sensitive stderr');
    harness.children[0]?.finish();

    await expect(completion).resolves.toEqual({
      action: 'restart',
      state: 'completed',
      startedAt: '2026-08-29T12:00:00.000Z',
      completedAt: '2026-08-29T12:00:01.000Z',
      outcome: 'succeeded',
    });
    expect(JSON.stringify(harness.controller.snapshot())).not.toContain('sensitive');
  });

  it('drains output beyond 64 KiB without exposing it', async () => {
    const harness = controllerHarness();
    const completion = harness.controller.execute('start');

    harness.children[0]?.stdout.write(Buffer.alloc(70 * 1024, 65));
    harness.children[0]?.stderr.write(Buffer.alloc(70 * 1024, 66));
    harness.children[0]?.finish(1);

    await expect(completion).resolves.toMatchObject({ outcome: 'failed' });
    expect(Object.keys(harness.controller.snapshot())).toEqual([
      'action', 'state', 'startedAt', 'completedAt', 'outcome',
    ]);
  });

  it('rejects a conflicting action without spawning or queueing it', async () => {
    const harness = controllerHarness();
    const first = harness.controller.execute('start');

    await expect(harness.controller.execute('restart')).rejects.toBeInstanceOf(BotActionConflictError);
    expect(harness.calls).toHaveLength(1);
    harness.children[0]?.finish();
    await first;
  });

  it('kills an action after 130 seconds and reports a generic timeout', async () => {
    vi.useFakeTimers();
    const harness = controllerHarness();
    const completion = harness.controller.execute('start');

    await vi.advanceTimersByTimeAsync(129_999);
    expect(harness.children[0]?.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.children[0]?.kill).toHaveBeenCalledOnce();
    harness.children[0]?.finish(null);

    await expect(completion).resolves.toMatchObject({ outcome: 'timed_out' });
  });

  it('settles and clears the active action when termination calls fail and close never arrives', async () => {
    vi.useFakeTimers();
    const harness = controllerHarness();
    const completion = harness.controller.execute('start');
    harness.children[0]?.kill
      .mockImplementationOnce(() => { throw new Error('graceful kill failed'); })
      .mockReturnValue(false);

    await vi.advanceTimersByTimeAsync(136_000);

    await expect(completion).resolves.toMatchObject({ outcome: 'timed_out' });
    const nextCompletion = harness.controller.execute('restart');
    expect(harness.calls).toHaveLength(2);
    harness.children[1]?.finish();
    await expect(nextCompletion).resolves.toMatchObject({ outcome: 'succeeded' });
  });

  it('stop terminates only the active child and awaits its completion', async () => {
    const harness = controllerHarness();
    const action = harness.controller.execute('stop');
    const teardown = harness.controller.stop();

    expect(harness.children[0]?.kill).toHaveBeenCalledOnce();
    let stopped = false;
    void teardown.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    harness.children[0]?.finish(null);

    await teardown;
    await expect(action).resolves.toMatchObject({ outcome: 'terminated' });
    await harness.controller.stop();
    expect(harness.children[0]?.kill).toHaveBeenCalledOnce();
  });

  it('bounds repeated stop calls when kills fail and close never arrives', async () => {
    vi.useFakeTimers();
    const harness = controllerHarness();
    const action = harness.controller.execute('stop');
    harness.children[0]?.kill.mockReturnValue(false);

    const firstStop = harness.controller.stop();
    const repeatedStop = harness.controller.stop();
    await vi.advanceTimersByTimeAsync(5_999);
    expect(harness.controller.snapshot()).toMatchObject({ state: 'running' });
    await vi.advanceTimersByTimeAsync(1);

    await Promise.all([firstStop, repeatedStop]);
    await expect(action).resolves.toMatchObject({ outcome: 'terminated' });
    expect(harness.children[0]?.kill).toHaveBeenCalledTimes(2);
    await harness.controller.stop();
    expect(harness.children[0]?.kill).toHaveBeenCalledTimes(2);
  });

  it('narrows only the three lowercase route actions', () => {
    expect(parseBotAction('start')).toBe('start');
    expect(parseBotAction('stop')).toBe('stop');
    expect(parseBotAction('restart')).toBe('restart');
    expect(() => parseBotAction('Start')).toThrow(InvalidBotActionError);
    expect(() => parseBotAction(['start'])).toThrow(InvalidBotActionError);
  });
});
