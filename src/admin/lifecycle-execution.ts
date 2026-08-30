import type { AdminAuditBotOutcome } from './audit-logger.js';
import type { BotAction, BotActionSnapshot } from './bot-controller.js';

export interface AdminLifecycleController {
  snapshot(): BotActionSnapshot;
  execute(action: BotAction): Promise<BotActionSnapshot>;
}

export type AdminLifecycleResult = {
  readonly action: BotAction;
  readonly outcome: AdminAuditBotOutcome;
  readonly durationMs: number;
};

export type AdminLifecycleConsumers = {
  readonly onSettled: (result: AdminLifecycleResult) => void;
  readonly onInternalFailure: () => void;
};

function failed(action: BotAction): AdminLifecycleResult {
  return { action, outcome: 'failed', durationMs: 0 };
}

function completed(action: BotAction, snapshot: BotActionSnapshot): AdminLifecycleResult {
  switch (snapshot.state) {
    case 'idle':
    case 'running':
      return failed(action);
    case 'completed': {
      const elapsed = Date.parse(snapshot.completedAt) - Date.parse(snapshot.startedAt);
      const durationMs = Number.isFinite(elapsed)
        ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(elapsed)))
        : 0;
      return { action, outcome: snapshot.outcome, durationMs };
    }
    default:
      return assertNever(snapshot);
  }
}

function assertNever(value: never): never {
  throw new TypeError('Unexpected bot state');
}

export function startLifecycleExecution(
  controller: AdminLifecycleController,
  action: BotAction,
  consumers: AdminLifecycleConsumers,
): void {
  void Promise.resolve()
    .then(() => controller.execute(action))
    .then(
      (snapshot) => completed(action, snapshot),
      () => failed(action),
    )
    .then((result) => consumers.onSettled(result))
    .then(undefined, () => consumers.onInternalFailure())
    // Detached lifecycle work must end here even if the fixed failure reporter breaks.
    .then(undefined, () => undefined);
}
