import { safeLogger } from './safe-logger.js';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type RuntimePhase = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface RuntimeHealthDocument {
  readonly schemaVersion: 1;
  readonly phase: RuntimePhase;
  readonly pid: number;
  readonly startedAt: string;
  readonly readyAt: string | null;
  readonly stoppingAt: string | null;
  readonly stoppedAt: string | null;
  readonly failedAt: string | null;
  readonly heartbeatAt: string;
  readonly discordReady: boolean;
  readonly guildCount: number | null;
}

interface RuntimeHealthClock {
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

const systemClock: RuntimeHealthClock = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle),
};

export class RuntimeHealth {
  private readonly clock: RuntimeHealthClock;
  private readonly now: () => Date;
  private readonly logger: Pick<Console, 'error'>;
  private readonly temporaryPath: string;
  private timer: ReturnType<typeof setInterval> | null;
  private document: RuntimeHealthDocument;
  private discordReadyProbe: (() => boolean) | null = null;
  private discordGuildCountProbe: (() => number) | null = null;

  public constructor(
    private readonly healthPath: string,
    options: {
      readonly heartbeatIntervalMs?: number;
      readonly clock?: RuntimeHealthClock;
      readonly now?: () => Date;
      readonly logger?: Pick<Console, 'error'>;
    } = {},
  ) {
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
    if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
      throw new Error('Health heartbeat interval must be a positive safe integer');
    }

    this.clock = options.clock ?? systemClock;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? safeLogger;
    this.temporaryPath = `${healthPath}.${process.pid}.tmp`;
    const startedAt = this.now().toISOString();
    this.document = {
      schemaVersion: 1,
      phase: 'starting',
      pid: process.pid,
      startedAt,
      readyAt: null,
      stoppingAt: null,
      stoppedAt: null,
      failedAt: null,
      heartbeatAt: startedAt,
      discordReady: false,
      guildCount: null,
    };
    mkdirSync(dirname(healthPath), { recursive: true });
    this.write();
    this.timer = this.clock.setInterval(() => this.heartbeat(), heartbeatIntervalMs);
    this.timer.unref?.();
  }

  public current(): RuntimeHealthDocument {
    return this.document;
  }

  public markReady(): void {
    if (this.document.phase !== 'starting' && this.document.phase !== 'ready') {
      return;
    }

    const now = this.now().toISOString();
    const discordReady = this.discordReadyProbe === null
      ? true
      : this.probeDiscordReady(false);
    this.document = {
      ...this.document,
      phase: 'ready',
      readyAt: this.document.readyAt ?? now,
      heartbeatAt: now,
      discordReady,
      guildCount: this.guildCountWhenReady(discordReady),
    };
    this.writeSafely();
  }

  public refreshDiscordReady(): void {
    if (this.document.phase !== 'ready') {
      return;
    }

    const discordReady = this.probeDiscordReady(false);
    this.document = {
      ...this.document,
      heartbeatAt: this.now().toISOString(),
      discordReady,
      guildCount: this.guildCountWhenReady(discordReady),
    };
    this.writeSafely();
  }

  public setDiscordReadyProbe(probe: () => boolean): void {
    this.discordReadyProbe = probe;
  }

  public setDiscordGuildCountProbe(probe: () => number): void {
    this.discordGuildCountProbe = probe;
  }

  public markStopping(): void {
    if (this.document.phase === 'stopped' || this.document.phase === 'failed') {
      return;
    }

    const now = this.now().toISOString();
    this.document = {
      ...this.document,
      phase: 'stopping',
      stoppingAt: this.document.stoppingAt ?? now,
      heartbeatAt: now,
      discordReady: false,
      guildCount: null,
    };
    this.writeSafely();
  }

  public markStopped(): void {
    const now = this.now().toISOString();
    this.document = {
      ...this.document,
      phase: 'stopped',
      stoppedAt: now,
      heartbeatAt: now,
      discordReady: false,
      guildCount: null,
    };
    if (this.writeSafely()) {
      this.stopHeartbeat();
    }
  }

  public markFailed(): void {
    const now = this.now().toISOString();
    this.document = {
      ...this.document,
      phase: 'failed',
      failedAt: now,
      heartbeatAt: now,
      discordReady: false,
      guildCount: null,
    };
    if (this.writeSafely()) {
      this.stopHeartbeat();
    }
  }

  private heartbeat(): void {
    if (this.document.phase === 'stopped' || this.document.phase === 'failed') {
      if (this.writeSafely()) {
        this.stopHeartbeat();
      }
      return;
    }

    const discordReady = this.document.phase === 'ready'
      ? this.probeDiscordReady(this.document.discordReady)
      : false;
    this.document = {
      ...this.document,
      heartbeatAt: this.now().toISOString(),
      discordReady,
      guildCount: this.guildCountWhenReady(discordReady),
    };
    this.writeSafely();
  }

  private stopHeartbeat(): void {
    if (this.timer !== null) {
      this.clock.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private guildCountWhenReady(discordReady: boolean): number | null {
    if (!discordReady) {
      return null;
    }
    try {
      const guildCount = this.discordGuildCountProbe?.();
      return guildCount !== undefined && Number.isSafeInteger(guildCount) && guildCount >= 0
        ? guildCount
        : null;
    } catch (_error: unknown) {
      this.logger.error(`${new Date().toISOString()} [health] Could not probe Discord guild count.`);
      return null;
    }
  }

  private probeDiscordReady(fallback: boolean): boolean {
    try {
      return this.discordReadyProbe?.() ?? fallback;
    } catch (_error: unknown) {
      this.logger.error(`${new Date().toISOString()} [health] Could not probe Discord readiness.`);
      return false;
    }
  }

  private writeSafely(): boolean {
    try {
      this.write();
      return true;
    } catch (_error: unknown) {
      this.logger.error(`${new Date().toISOString()} [health] Could not update runtime health.`);
      return false;
    }
  }

  private write(): void {
    writeFileSync(this.temporaryPath, JSON.stringify(this.document), 'utf8');
    renameSync(this.temporaryPath, this.healthPath);
  }
}
