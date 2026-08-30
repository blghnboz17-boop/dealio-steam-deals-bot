import type { BotAction, BotActionSnapshot } from './bot-controller.js';
import type { AdminHealthResult } from './contracts.js';

export type LifecyclePolicy = {
  readonly enabledActions: readonly BotAction[];
  readonly emphasizedAction: BotAction | null;
  readonly busy: boolean;
};

export function getLifecyclePolicy(
  health: AdminHealthResult,
  lifecycle: BotActionSnapshot,
): LifecyclePolicy {
  switch (lifecycle.state) {
    case 'running':
      return { enabledActions: [], emphasizedAction: null, busy: true };
    case 'idle':
    case 'completed': {
      switch (health.status) {
        case 'available':
          switch (health.phase) {
            case 'stopped':
            case 'failed':
              return { enabledActions: ['start'], emphasizedAction: 'start', busy: false };
            case 'ready':
              return { enabledActions: ['restart', 'stop'], emphasizedAction: 'restart', busy: false };
            case 'starting':
              return { enabledActions: ['stop'], emphasizedAction: null, busy: false };
            case 'stopping':
              return { enabledActions: [], emphasizedAction: null, busy: false };
            default:
              return assertNever(health.phase);
          }
        case 'unavailable':
          switch (health.reason) {
            case 'unavailable':
            case 'stale':
              return { enabledActions: ['start'], emphasizedAction: 'start', busy: false };
            case 'malformed':
            case 'oversized':
            case 'unsupported':
            case 'future':
              return { enabledActions: [], emphasizedAction: null, busy: false };
            default:
              return assertNever(health.reason);
          }
        default:
          return assertNever(health);
      }
    }
    default:
      return assertNever(lifecycle);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected lifecycle policy state: ${String(value)}`);
}
