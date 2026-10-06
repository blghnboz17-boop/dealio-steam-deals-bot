import { format } from 'node:util';
import { redactSecrets } from '../application/safe-logger.js';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly id: number;
  readonly at: string;
  readonly level: LogLevel;
  readonly text: string;
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';
const levels: Record<ConsoleMethod, LogLevel> = { log: 'info', info: 'info', warn: 'warn', error: 'error' };
const maximumLineLength = 4_000;

/**
 * The most recent process log lines for the admin panel. It copies what the process
 * already writes to journald; lines are redacted again and never stored on disk.
 */
export class LogBuffer {
  private readonly entries: LogEntry[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private nextId = 1;
  private restore: (() => void) | null = null;

  public constructor(
    private readonly capacity = 1_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public push(level: LogLevel, text: string): LogEntry {
    const entry: LogEntry = {
      id: this.nextId,
      at: this.now().toISOString(),
      level,
      text: redactSecrets(text).slice(0, maximumLineLength),
    };
    this.nextId += 1;
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
    for (const listener of this.listeners) {
      try { listener(entry); } catch { /* a closed stream must not break logging */ }
    }
    return entry;
  }

  public list(afterId = 0): LogEntry[] {
    return this.entries.filter((entry) => entry.id > afterId);
  }

  public subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Tees console output into the buffer; the original output is unchanged. */
  public install(target: Pick<Console, ConsoleMethod> = console): void {
    if (this.restore) return;
    const originals = new Map<ConsoleMethod, (...values: unknown[]) => void>();
    for (const method of Object.keys(levels) as ConsoleMethod[]) {
      const original = target[method];
      originals.set(method, original);
      target[method] = (...values: unknown[]): void => {
        original.apply(target, values);
        try { this.push(levels[method], format(...values)); } catch { /* never break logging */ }
      };
    }
    this.restore = () => {
      for (const [method, original] of originals) target[method] = original;
    };
  }

  public uninstall(): void {
    this.restore?.();
    this.restore = null;
    this.listeners.clear();
  }
}
