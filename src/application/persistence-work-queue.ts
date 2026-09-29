import { setImmediate as nextEventLoopTurn } from 'node:timers/promises';

/** Keep synchronous SQLite transactions atomic, but let I/O run between users. */
export class PersistenceWorkQueue {
  private tail: Promise<unknown> = Promise.resolve();

  public run<T>(operation: () => T): Promise<T> {
    const result = this.tail.then(async () => {
      await nextEventLoopTurn();
      return operation();
    });
    // A failed transaction must not prevent later users from being processed.
    this.tail = result.catch(() => undefined);
    return result;
  }
}
