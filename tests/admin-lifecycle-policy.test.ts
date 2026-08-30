import { describe, expect, it } from 'vitest';
import type { BotAction, BotActionSnapshot } from '../src/admin/bot-controller.js';
import type { AdminHealthResult, RuntimePhase } from '../src/admin/contracts.js';
import { getLifecyclePolicy } from '../src/admin/lifecycle-policy.js';

type ExpectedPolicy = {
  readonly enabledActions: readonly BotAction[];
  readonly emphasizedAction: BotAction | null;
  readonly busy: boolean;
};

const idle: BotActionSnapshot = { state: 'idle' };

function availableHealth(phase: RuntimePhase): AdminHealthResult {
  return {
    status: 'available',
    phase,
    discordReady: phase === 'ready',
    guildCount: phase === 'ready' ? 4 : null,
    startedAt: '2026-08-29T09:00:00.000Z',
    readyAt: phase === 'ready' ? '2026-08-29T09:00:05.000Z' : null,
    heartbeatAt: '2026-08-29T11:59:55.000Z',
  };
}

describe('admin lifecycle policy', () => {
  it.each<readonly [string, AdminHealthResult, ExpectedPolicy]>([
    ['missing health', { status: 'unavailable', reason: 'unavailable' }, { enabledActions: ['start'], emphasizedAction: 'start', busy: false }],
    ['stale health', { status: 'unavailable', reason: 'stale' }, { enabledActions: ['start'], emphasizedAction: 'start', busy: false }],
    ['malformed health', { status: 'unavailable', reason: 'malformed' }, { enabledActions: [], emphasizedAction: null, busy: false }],
    ['oversized health', { status: 'unavailable', reason: 'oversized' }, { enabledActions: [], emphasizedAction: null, busy: false }],
    ['unsupported health', { status: 'unavailable', reason: 'unsupported' }, { enabledActions: [], emphasizedAction: null, busy: false }],
    ['future health', { status: 'unavailable', reason: 'future' }, { enabledActions: [], emphasizedAction: null, busy: false }],
    ['stopped bot', availableHealth('stopped'), { enabledActions: ['start'], emphasizedAction: 'start', busy: false }],
    ['failed bot', availableHealth('failed'), { enabledActions: ['start'], emphasizedAction: 'start', busy: false }],
    ['ready bot', availableHealth('ready'), { enabledActions: ['restart', 'stop'], emphasizedAction: 'restart', busy: false }],
    ['starting bot', availableHealth('starting'), { enabledActions: ['stop'], emphasizedAction: null, busy: false }],
    ['stopping bot', availableHealth('stopping'), { enabledActions: [], emphasizedAction: null, busy: false }],
  ])('returns the exhaustive action matrix for %s', (_case, health, expected) => {
    // Given an idle lifecycle controller and the table health state.
    // When the shared policy is evaluated.
    const policy = getLifecyclePolicy(health, idle);

    // Then only the expected actions and emphasis are available.
    expect(policy).toEqual(expected);
  });

  it.each<readonly [string, BotActionSnapshot]>([
    ['idle', idle],
    ['completed', {
      action: 'start',
      state: 'completed',
      startedAt: '2026-08-29T12:00:00.000Z',
      completedAt: '2026-08-29T12:00:05.000Z',
      outcome: 'succeeded',
    }],
  ])('uses current health when the controller is %s', (_case, lifecycle) => {
    // Given a lifecycle controller that is not running.
    // When policy is evaluated for a ready bot.
    const policy = getLifecyclePolicy(availableHealth('ready'), lifecycle);

    // Then the ready actions remain available.
    expect(policy).toEqual({
      enabledActions: ['restart', 'stop'],
      emphasizedAction: 'restart',
      busy: false,
    });
  });

  it('disables every action while the controller is running', () => {
    // Given an active controller action and otherwise startable health.
    const lifecycle: BotActionSnapshot = {
      action: 'start',
      state: 'running',
      startedAt: '2026-08-29T12:00:00.000Z',
    };

    // When the shared policy is evaluated.
    const policy = getLifecyclePolicy({ status: 'unavailable', reason: 'stale' }, lifecycle);

    // Then action concurrency is blocked and controls report busy.
    expect(policy).toEqual({ enabledActions: [], emphasizedAction: null, busy: true });
  });
});
