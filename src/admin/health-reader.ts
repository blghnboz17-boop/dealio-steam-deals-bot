import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { AdminHealthResult, RuntimePhase } from './contracts.js';
import { runtimePhases } from './contracts.js';

const maximumDocumentBytes = 16_384;
const maximumFutureMs = 5_000;
const maximumAgeMs = 30_000;

type HealthReaderOptions = {
  readonly now?: () => Date;
  readonly maximumBytes?: number;
};

type DocumentReadResult =
  | { readonly status: 'read'; readonly contents: Buffer }
  | { readonly status: 'unavailable' }
  | { readonly status: 'oversized' };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isRuntimePhase(value: unknown): value is RuntimePhase {
  return typeof value === 'string' && runtimePhases.some((phase) => phase === value);
}

export class AdminHealthReader {
  private readonly now: () => Date;
  private readonly maximumBytes: number;

  public constructor(
    private readonly healthPath: string,
    options: HealthReaderOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.maximumBytes = options.maximumBytes ?? maximumDocumentBytes;
  }

  public readSnapshot(): AdminHealthResult {
    const document = this.readDocument();
    if (document.status === 'unavailable') {
      return { status: 'unavailable', reason: 'unavailable' };
    }
    if (document.status === 'oversized') {
      return { status: 'unavailable', reason: 'oversized' };
    }

    let input: unknown;
    try {
      input = JSON.parse(document.contents.toString('utf8'));
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      return { status: 'unavailable', reason: 'malformed' };
    }
    if (!isRecord(input)) {
      return { status: 'unavailable', reason: 'malformed' };
    }
    if (input['schemaVersion'] !== 1) {
      return { status: 'unavailable', reason: 'unsupported' };
    }
    return this.parseVersionOne(input);
  }

  private readDocument(): DocumentReadResult {
    let descriptor: number | undefined;
    let result: DocumentReadResult = { status: 'unavailable' };
    try {
      descriptor = openSync(this.healthPath, 'r');
      if (fstatSync(descriptor).size > this.maximumBytes) {
        result = { status: 'oversized' };
      } else {
        const buffer = Buffer.alloc(this.maximumBytes + 1);
        const bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, 0);
        result = bytesRead > this.maximumBytes
          ? { status: 'oversized' }
          : { status: 'read', contents: buffer.subarray(0, bytesRead) };
      }
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      result = { status: 'unavailable' };
    } finally {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch (error: unknown) {
          if (!(error instanceof Error)) {
            throw error;
          }
          result = { status: 'unavailable' };
        }
      }
    }
    return result;
  }

  private parseVersionOne(input: Readonly<Record<string, unknown>>): AdminHealthResult {
    const guildCount = input['guildCount'];
    const validGuildCount = guildCount === undefined || guildCount === null
      || (typeof guildCount === 'number' && Number.isSafeInteger(guildCount) && guildCount >= 0);
    if (
      !isRuntimePhase(input['phase'])
      || typeof input['pid'] !== 'number'
      || !Number.isSafeInteger(input['pid'])
      || input['pid'] <= 0
      || !isTimestamp(input['startedAt'])
      || !isNullableTimestamp(input['readyAt'])
      || !isNullableTimestamp(input['stoppingAt'])
      || !isNullableTimestamp(input['stoppedAt'])
      || !isNullableTimestamp(input['failedAt'])
      || !isTimestamp(input['heartbeatAt'])
      || typeof input['discordReady'] !== 'boolean'
      || !validGuildCount
    ) {
      return { status: 'unavailable', reason: 'malformed' };
    }

    const ageMs = this.now().getTime() - Date.parse(input['heartbeatAt']);
    if (ageMs < -maximumFutureMs) {
      return { status: 'unavailable', reason: 'future' };
    }
    if (ageMs > maximumAgeMs) {
      return { status: 'unavailable', reason: 'stale' };
    }
    return {
      status: 'available',
      phase: input['phase'],
      discordReady: input['discordReady'],
      guildCount: guildCount ?? null,
      startedAt: input['startedAt'],
      readyAt: input['readyAt'],
      heartbeatAt: input['heartbeatAt'],
    };
  }
}
