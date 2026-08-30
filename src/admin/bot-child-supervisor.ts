import type { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';

const OUTPUT_LIMIT_BYTES = 64 * 1024;
const DEFAULT_ACTION_DEADLINE_MS = 130_000;
const DEFAULT_GRACEFUL_TERMINATION_MS = 5_000;
const DEFAULT_FINAL_SETTLEMENT_MS = 1_000;

export type BotChildOutcome = 'succeeded' | 'failed' | 'timed_out' | 'terminated';
type TerminationReason = Extract<BotChildOutcome, 'timed_out' | 'terminated'>;

export interface SupervisedBotChild extends Pick<EventEmitter, 'on' | 'off'> {
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface BotChildTimer {
  clear(): void;
}

export interface BotChildTimers {
  setTimeout(callback: () => void, delayMs: number): BotChildTimer;
}

export type BotChildSupervisorOptions = {
  readonly timers?: BotChildTimers;
  readonly actionDeadlineMs?: number;
  readonly gracefulTerminationMs?: number;
  readonly finalSettlementMs?: number;
};

const systemTimers: BotChildTimers = {
  setTimeout: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return { clear: () => clearTimeout(handle) };
  },
};

function captureBounded(stream: Readable): () => void {
  let captured = Buffer.alloc(0);
  const onData = (chunk: Buffer | string): void => {
    const remaining = OUTPUT_LIMIT_BYTES - captured.byteLength;
    if (remaining <= 0) return;
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    captured = Buffer.concat([captured, bytes.subarray(0, remaining)]);
  };
  stream.on('data', onData);
  return () => {
    stream.off('data', onData);
    captured = Buffer.alloc(0);
  };
}

function requestKill(child: SupervisedBotChild, signal?: NodeJS.Signals): void {
  try {
    if (signal === undefined) {
      child.kill();
      return;
    }
    child.kill(signal);
  } catch (error) {
    if (!(error instanceof Error)) return;
  }
}

export class BotChildSupervisor {
  readonly completion: Promise<BotChildOutcome>;
  private readonly child: SupervisedBotChild;
  private readonly timers: BotChildTimers;
  private readonly gracefulTerminationMs: number;
  private readonly finalSettlementMs: number;
  private readonly scheduledTimers = new Set<BotChildTimer>();
  private readonly clearStdout: () => void;
  private readonly clearStderr: () => void;
  private actionDeadline: BotChildTimer | null = null;
  private terminationReason: TerminationReason | null = null;
  private settled = false;
  private resolveCompletion: (outcome: BotChildOutcome) => void = () => undefined;

  constructor(child: SupervisedBotChild, options: BotChildSupervisorOptions = {}) {
    this.child = child;
    this.timers = options.timers ?? systemTimers;
    this.gracefulTerminationMs = options.gracefulTerminationMs
      ?? DEFAULT_GRACEFUL_TERMINATION_MS;
    this.finalSettlementMs = options.finalSettlementMs ?? DEFAULT_FINAL_SETTLEMENT_MS;
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
    this.clearStdout = captureBounded(child.stdout);
    this.clearStderr = captureBounded(child.stderr);
    child.on('error', this.onLateError);
    child.on('error', this.onError);
    child.on('exit', this.onExit);
    child.on('close', this.onClose);
    this.actionDeadline = this.schedule(() => {
      this.beginTermination('timed_out');
    }, options.actionDeadlineMs ?? DEFAULT_ACTION_DEADLINE_MS);
  }

  stop(): Promise<BotChildOutcome> {
    this.beginTermination('terminated');
    return this.completion;
  }

  private readonly onLateError = (): void => undefined;

  private readonly onError = (): void => {
    this.complete(this.terminationReason ?? 'failed');
  };

  private readonly onExit = (exitCode: number | null): void => {
    this.complete(this.terminationReason ?? (exitCode === 0 ? 'succeeded' : 'failed'));
  };

  private readonly onClose = (exitCode: number | null): void => {
    this.complete(this.terminationReason ?? (exitCode === 0 ? 'succeeded' : 'failed'));
  };

  private beginTermination(reason: TerminationReason): void {
    if (this.settled || this.terminationReason !== null) return;
    this.terminationReason = reason;
    this.actionDeadline?.clear();
    requestKill(this.child);
    if (this.settled) return;
    this.schedule(() => {
      requestKill(this.child, 'SIGKILL');
      if (this.settled) return;
      this.schedule(() => this.complete(reason), this.finalSettlementMs);
    }, this.gracefulTerminationMs);
  }

  private schedule(callback: () => void, delayMs: number): BotChildTimer {
    const timer = this.timers.setTimeout(callback, delayMs);
    this.scheduledTimers.add(timer);
    return timer;
  }

  private complete(outcome: BotChildOutcome): void {
    if (this.settled) return;
    this.settled = true;
    for (const timer of this.scheduledTimers) timer.clear();
    this.scheduledTimers.clear();
    this.clearStdout();
    this.clearStderr();
    this.child.off('error', this.onError);
    this.child.off('exit', this.onExit);
    this.child.off('close', this.onClose);
    this.resolveCompletion(outcome);
  }
}
