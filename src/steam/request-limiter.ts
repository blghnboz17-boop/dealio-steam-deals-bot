const maxTimerDelayMs = 2_147_483_647;

async function sleepWithSafeTimers(delayMs: number): Promise<void> {
  let remaining = delayMs;
  while (remaining > 0) {
    const chunk = Math.min(remaining, maxTimerDelayMs);
    await new Promise<void>((resolve) => setTimeout(resolve, chunk));
    remaining -= chunk;
  }
}

export class SteamRequestLimiter {
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];
  private pause: Promise<void> = Promise.resolve();

  public constructor(
    private readonly maxConcurrency: number,
    private readonly sleep: (delayMs: number) => Promise<void> = (delayMs) =>
      sleepWithSafeTimers(delayMs),
  ) {
    if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency <= 0) {
      throw new Error('Steam request concurrency must be a positive safe integer');
    }
  }

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.activeCount += 1;
    try {
      while (true) {
        const currentPause = this.pause;
        await currentPause;
        if (this.pause === currentPause) {
          break;
        }
      }
      return await operation();
    } finally {
      this.activeCount -= 1;
      this.queue.shift()?.();
    }
  }

  public deferFor(delayMs: number): void {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
      throw new Error('Steam retry delay must be a non-negative safe integer');
    }

    const previousPause = this.pause;
    const nextPause = Promise.all([previousPause, this.sleep(delayMs)]).then(() => undefined);
    this.pause = nextPause;
    void nextPause.then(() => {
      if (this.pause === nextPause) {
        this.pause = Promise.resolve();
      }
    });
  }
}

export const globalSteamRequestLimiter = new SteamRequestLimiter(6);
