import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  BotChildSupervisor,
  type BotChildTimer,
  type BotChildTimers,
  type SupervisedBotChild,
} from '../src/admin/bot-child-supervisor.js';

type KillBehavior = 'succeeds' | 'returns_false' | 'throws';

class ChildFake extends EventEmitter implements SupervisedBotChild {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  private readonly killBehaviors: KillBehavior[];
  readonly kill = vi.fn((signal?: NodeJS.Signals | number): boolean => {
    const behavior = this.killBehaviors.shift() ?? 'succeeds';
    if (behavior === 'throws') throw new Error(`kill failed: ${signal ?? 'default'}`);
    return behavior === 'succeeds';
  });

  constructor(killBehaviors: readonly KillBehavior[] = []) {
    super();
    this.killBehaviors = [...killBehaviors];
  }

  close(exitCode: number | null): void {
    this.emit('close', exitCode, null);
  }

  exit(exitCode: number | null): void {
    this.emit('exit', exitCode, null);
  }

  fail(): void {
    this.emit('error', new Error('child failed'));
  }
}

type ScheduledTimer = {
  readonly callback: () => void;
  readonly dueAt: number;
  active: boolean;
};

class TimerFake implements BotChildTimers {
  private now = 0;
  private readonly scheduled: ScheduledTimer[] = [];

  setTimeout(callback: () => void, delayMs: number): BotChildTimer {
    const timer: ScheduledTimer = { active: true, callback, dueAt: this.now + delayMs };
    this.scheduled.push(timer);
    return {
      clear: () => {
        timer.active = false;
      },
    };
  }

  advanceBy(delayMs: number): void {
    const target = this.now + delayMs;
    while (true) {
      const next = this.scheduled
        .filter((timer) => timer.active && timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (next === undefined) break;
      this.now = next.dueAt;
      next.active = false;
      next.callback();
    }
    this.now = target;
  }

  pendingCount(): number {
    return this.scheduled.filter((timer) => timer.active).length;
  }
}

function supervisorHarness(killBehaviors: readonly KillBehavior[] = []) {
  const child = new ChildFake(killBehaviors);
  const timers = new TimerFake();
  const supervisor = new BotChildSupervisor(child, { timers });
  return { child, supervisor, timers };
}

describe('BotChildSupervisor', () => {
  it.each([
    [0, 'succeeded'],
    [1, 'failed'],
    [null, 'failed'],
  ] as const)('settles a normal close with code %s as %s', async (exitCode, outcome) => {
    // Given
    const harness = supervisorHarness();

    // When
    harness.child.close(exitCode);

    // Then
    await expect(harness.supervisor.completion).resolves.toBe(outcome);
  });

  it('settles a child error as failed', async () => {
    // Given
    const harness = supervisorHarness();

    // When
    harness.child.fail();

    // Then
    await expect(harness.supervisor.completion).resolves.toBe('failed');
  });

  it('settles on process exit when inherited streams remain open', async () => {
    // Given
    const harness = supervisorHarness();

    // When
    harness.child.exit(0);
    harness.timers.advanceBy(136_000);

    // Then
    await expect(harness.supervisor.completion).resolves.toBe('succeeded');
  });

  it('uses the exact action, graceful, and final settlement deadlines', async () => {
    // Given
    const harness = supervisorHarness();
    let outcome: string | null = null;
    void harness.supervisor.completion.then((value) => { outcome = value; });

    // When / Then
    harness.timers.advanceBy(129_999);
    expect(harness.child.kill).not.toHaveBeenCalled();
    harness.timers.advanceBy(1);
    expect(harness.child.kill).toHaveBeenNthCalledWith(1);
    harness.timers.advanceBy(4_999);
    expect(harness.child.kill).toHaveBeenCalledOnce();
    harness.timers.advanceBy(1);
    expect(harness.child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    harness.timers.advanceBy(999);
    await Promise.resolve();
    expect(outcome).toBeNull();
    harness.timers.advanceBy(1);
    await expect(harness.supervisor.completion).resolves.toBe('timed_out');
  });

  it.each(['returns_false', 'throws'] as const)(
    'continues to force termination when graceful kill %s',
    async (behavior) => {
      // Given
      const harness = supervisorHarness([behavior]);

      // When
      harness.timers.advanceBy(130_000 + 5_000);

      // Then
      expect(harness.child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
      harness.timers.advanceBy(1_000);
      await expect(harness.supervisor.completion).resolves.toBe('timed_out');
    },
  );

  it.each(['returns_false', 'throws'] as const)(
    'settles after the final deadline when force kill %s',
    async (behavior) => {
      // Given
      const harness = supervisorHarness(['succeeds', behavior]);

      // When
      harness.timers.advanceBy(136_000);

      // Then
      await expect(harness.supervisor.completion).resolves.toBe('timed_out');
    },
  );

  it('keeps terminated when stop starts before the action deadline', async () => {
    // Given
    const harness = supervisorHarness();

    // When
    const firstStop = harness.supervisor.stop();
    const repeatedStop = harness.supervisor.stop();
    harness.timers.advanceBy(6_000);

    // Then
    await expect(firstStop).resolves.toBe('terminated');
    await expect(repeatedStop).resolves.toBe('terminated');
    expect(harness.child.kill).toHaveBeenCalledTimes(2);
  });

  it('keeps timed_out when stop arrives after the action deadline', async () => {
    // Given
    const harness = supervisorHarness();
    harness.timers.advanceBy(130_000);

    // When
    const stop = harness.supervisor.stop();
    harness.timers.advanceBy(6_000);

    // Then
    await expect(stop).resolves.toBe('timed_out');
    expect(harness.child.kill).toHaveBeenCalledTimes(2);
  });

  it('uses the first termination reason when close or error arrives during shutdown', async () => {
    // Given
    const timedOut = supervisorHarness();
    timedOut.timers.advanceBy(130_000);
    const terminated = supervisorHarness();
    const stop = terminated.supervisor.stop();

    // When
    timedOut.child.fail();
    terminated.child.close(null);

    // Then
    await expect(timedOut.supervisor.completion).resolves.toBe('timed_out');
    await expect(stop).resolves.toBe('terminated');
  });

  it('cancels timers and removes stream and operational listeners on close', async () => {
    // Given
    const harness = supervisorHarness();
    expect(harness.child.stdout.listenerCount('data')).toBe(1);
    expect(harness.child.stderr.listenerCount('data')).toBe(1);
    expect(harness.child.listenerCount('exit')).toBe(1);
    expect(harness.child.listenerCount('close')).toBe(1);
    expect(harness.child.listenerCount('error')).toBe(2);

    // When
    harness.child.close(0);
    await harness.supervisor.completion;

    // Then
    expect(harness.timers.pendingCount()).toBe(0);
    expect(harness.child.stdout.listenerCount('data')).toBe(0);
    expect(harness.child.stderr.listenerCount('data')).toBe(0);
    expect(harness.child.listenerCount('exit')).toBe(0);
    expect(harness.child.listenerCount('close')).toBe(0);
    expect(harness.child.listenerCount('error')).toBe(1);
    harness.timers.advanceBy(200_000);
    expect(harness.child.kill).not.toHaveBeenCalled();
  });

  it('ignores late close and error events after one synthetic settlement', async () => {
    // Given
    const harness = supervisorHarness();
    const outcomes: string[] = [];
    void harness.supervisor.completion.then((outcome) => outcomes.push(outcome));
    harness.timers.advanceBy(136_000);
    await harness.supervisor.completion;

    // When
    harness.child.close(0);
    harness.child.fail();
    await Promise.resolve();

    // Then
    expect(outcomes).toEqual(['timed_out']);
  });
});
