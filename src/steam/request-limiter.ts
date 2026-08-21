const maxTimerDelayMs = 2_147_483_647;

async function sleepWithSafeTimers(delayMs: number, signal?: AbortSignal): Promise<void> {
  let remaining = delayMs;
  while (remaining > 0) {
    const chunk = Math.min(remaining, maxTimerDelayMs);
    await abortableDelay(chunk, signal);
    remaining -= chunk;
  }
}

interface QueueEntry {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly abort: () => void;
  cancelled: boolean;
}

export class SteamRequestLimiter {
  private activeCount = 0;
  private readonly queue: QueueEntry[] = [];
  private pause: Promise<void> = Promise.resolve();

  public constructor(
    private readonly maxConcurrency: number,
    private readonly sleep: (delayMs: number, signal?: AbortSignal) => Promise<void> =
      sleepWithSafeTimers,
  ) {
    if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency <= 0) {
      throw new Error('Steam request concurrency must be a positive safe integer');
    }
  }

  public async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      while (true) {
        const currentPause = this.pause;
        await waitForPromise(currentPause, signal);
        if (this.pause === currentPause) {
          break;
        }
      }
      return await operation();
    } finally {
      this.release();
    }
  }

  public deferFor(delayMs: number, signal?: AbortSignal): void {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
      throw new Error('Steam retry delay must be a non-negative safe integer');
    }

    const previousPause = this.pause;
    const delay = this.sleep(delayMs, signal).catch((error: unknown) => {
      if (!signal?.aborted) {
        throw error;
      }
    });
    const nextPause = Promise.all([previousPause, delay]).then(() => undefined);
    this.pause = nextPause;
    void nextPause.then(() => {
      if (this.pause === nextPause) {
        this.pause = Promise.resolve();
      }
    });
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(abortError());
    }

    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve: () => {
          signal?.removeEventListener('abort', entry.abort);
          resolve();
        },
        reject,
        signal,
        abort: () => {
          entry.cancelled = true;
          reject(abortError());
        },
        cancelled: false,
      };
      signal?.addEventListener('abort', entry.abort, { once: true });
      this.queue.push(entry);
    });
  }

  private release(): void {
    this.activeCount -= 1;
    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry || entry.cancelled) {
        entry?.signal?.removeEventListener('abort', entry.abort);
        continue;
      }

      this.activeCount += 1;
      entry.resolve();
      break;
    }
  }
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise<void>((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function waitForPromise(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise<void>((resolve, reject) => {
    const abort = (): void => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      () => {
        signal.removeEventListener('abort', abort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error('Steam limiter pause failed'));
      },
    );
  });
}

function abortError(): Error {
  return new DOMException('Steam request cancelled', 'AbortError');
}

export const globalSteamRequestLimiter = new SteamRequestLimiter(6);
