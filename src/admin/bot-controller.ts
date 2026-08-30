import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  BotChildSupervisor,
  type BotChildOutcome,
  type BotChildSupervisorOptions,
  type SupervisedBotChild,
} from './bot-child-supervisor.js';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CONTROL_SCRIPT = resolve(PROJECT_ROOT, 'scripts', 'bot-control.ps1');

export const BOT_ACTIONS = ['start', 'stop', 'restart'] as const;
export type BotAction = (typeof BOT_ACTIONS)[number];

type BotActionOutcome = BotChildOutcome;

export type BotActionSnapshot =
  | { readonly state: 'idle' }
  | {
    readonly action: BotAction;
    readonly state: 'running';
    readonly startedAt: string;
  }
  | {
    readonly action: BotAction;
    readonly state: 'completed';
    readonly startedAt: string;
    readonly completedAt: string;
    readonly outcome: BotActionOutcome;
  };

export type BotControlSpawnOptions = {
  readonly cwd: string;
  readonly shell: false;
  readonly windowsHide: true;
  readonly stdio: readonly ['ignore', 'pipe', 'pipe'];
};

export type BotControlChild = SupervisedBotChild;

export type BotControlSpawn = (
  command: string,
  arguments_: readonly string[],
  options: BotControlSpawnOptions,
) => BotControlChild;

type ActiveAction = {
  readonly supervisor: BotChildSupervisor;
  readonly completion: Promise<BotActionSnapshot>;
};

export class InvalidBotActionError extends Error {
  readonly name = 'InvalidBotActionError';

  constructor() {
    super('Invalid bot action');
  }
}

export class BotActionConflictError extends Error {
  readonly name = 'BotActionConflictError';

  constructor(readonly activeAction: BotAction) {
    super('A bot action is already in progress');
  }
}

export function parseBotAction(value: unknown): BotAction {
  switch (value) {
    case 'start':
    case 'stop':
    case 'restart':
      return value;
    default:
      throw new InvalidBotActionError();
  }
}

function scriptAction(action: BotAction): 'Start' | 'Stop' | 'Restart' {
  switch (action) {
    case 'start':
      return 'Start';
    case 'stop':
      return 'Stop';
    case 'restart':
      return 'Restart';
    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new InvalidBotActionError();
}

const systemSpawn: BotControlSpawn = (command, arguments_, options) => spawn(
  command,
  [...arguments_],
  {
    cwd: options.cwd,
    shell: options.shell,
    windowsHide: options.windowsHide,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

export class BotController {
  private readonly spawn: BotControlSpawn;
  private readonly now: () => Date;
  private readonly supervisorOptions: BotChildSupervisorOptions;
  private active: ActiveAction | null = null;
  private currentSnapshot: BotActionSnapshot = { state: 'idle' };

  constructor(options: {
    readonly spawn?: BotControlSpawn;
    readonly now?: () => Date;
    readonly supervisor?: BotChildSupervisorOptions;
  } = {}) {
    this.spawn = options.spawn ?? systemSpawn;
    this.now = options.now ?? (() => new Date());
    this.supervisorOptions = options.supervisor ?? {};
  }

  snapshot(): BotActionSnapshot {
    return this.currentSnapshot;
  }

  async execute(action: BotAction): Promise<BotActionSnapshot> {
    if (this.active !== null) {
      throw new BotActionConflictError(this.currentSnapshot.state === 'running'
        ? this.currentSnapshot.action
        : action);
    }

    const startedAt = this.now().toISOString();
    this.currentSnapshot = { action, state: 'running', startedAt };
    let child: BotControlChild;
    try {
      child = this.spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        CONTROL_SCRIPT,
        '-Action',
        scriptAction(action),
        '-ProjectRoot',
        PROJECT_ROOT,
      ], {
        cwd: PROJECT_ROOT,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const failed = this.completedSnapshot(action, startedAt, 'failed');
      this.currentSnapshot = failed;
      return failed;
    }

    const supervisor = new BotChildSupervisor(child, this.supervisorOptions);
    const completion = supervisor.completion.then((outcome) => {
      const completed = this.completedSnapshot(action, startedAt, outcome);
      this.currentSnapshot = completed;
      if (this.active?.supervisor === supervisor) this.active = null;
      return completed;
    });
    const active: ActiveAction = {
      supervisor,
      completion,
    };
    this.active = active;
    return completion;
  }

  async stop(): Promise<void> {
    const active = this.active;
    if (active === null) return;
    await active.supervisor.stop();
    await active.completion;
  }

  private completedSnapshot(
    action: BotAction,
    startedAt: string,
    outcome: BotActionOutcome,
  ): BotActionSnapshot {
    return {
      action,
      state: 'completed',
      startedAt,
      completedAt: this.now().toISOString(),
      outcome,
    };
  }
}
