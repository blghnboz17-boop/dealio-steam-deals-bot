export type QueueResult =
  | { readonly kind: "processed" }
  | { readonly kind: "handler-failed" }
  | { readonly kind: "timed-out" }
  | { readonly kind: "rejected"; readonly reason: "capacity" };

export type QueueIssue = {
  readonly reason: "capacity" | "handler-failed";
  readonly eventId: string;
  readonly sessionId?: string;
};

export type QueueOptions = {
  readonly priority?: "critical" | "ordinary";
  readonly awaitCompletion?: boolean;
  readonly eventId?: string;
  readonly sessionId?: string;
};

type QueueEntry = {
  readonly operation: () => Promise<void>;
  readonly options: QueueOptions;
  readonly resolve: (result: QueueResult) => void;
};

const MAX_ISSUES = 20;

async function waitBoundedly(promise: Promise<QueueResult>, timeoutMs: number): Promise<QueueResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<QueueResult>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timed-out" }), timeoutMs);
  });
  const result = await Promise.race([promise, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

export class BoundedEventQueue {
  private readonly pending: QueueEntry[] = [];
  private readonly issues: QueueIssue[] = [];
  private active = false;
  private idle: Promise<void> = Promise.resolve();
  private resolveIdle: (() => void) | undefined;

  constructor(
    private readonly capacity: number,
    private readonly handlerTimeoutMs: number,
    private readonly onIssue?: (issue: QueueIssue) => Promise<void>,
  ) {}

  enqueue(operation: () => Promise<void>, options: QueueOptions = {}): Promise<QueueResult> {
    let displaced: QueueEntry | undefined;
    if (this.pending.length >= this.capacity) {
      const index = options.priority === "critical"
        ? this.pending.findIndex((entry) => entry.options.priority !== "critical")
        : -1;
      if (index >= 0) displaced = this.pending.splice(index, 1)[0];
      else {
        this.recordIssue({ reason: "capacity", eventId: options.eventId ?? "queue-capacity", ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }) });
        return Promise.resolve({ kind: "rejected", reason: "capacity" });
      }
    }
    if (displaced !== undefined) {
      displaced.resolve({ kind: "rejected", reason: "capacity" });
      this.recordIssue({ reason: "capacity", eventId: displaced.options.eventId ?? "queue-capacity", ...(displaced.options.sessionId === undefined ? {} : { sessionId: displaced.options.sessionId }) });
    }
    const completed = new Promise<QueueResult>((resolve) => {
      this.pending.push({ operation, options, resolve });
    });
    this.startDrain();
    return options.awaitCompletion === true ? completed : waitBoundedly(completed, this.handlerTimeoutMs);
  }

  async flush(timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
    const result = await Promise.race([this.idle.then(() => true as const), timeout]);
    if (timer !== undefined) clearTimeout(timer);
    return result;
  }

  private startDrain(): void {
    if (this.active) return;
    this.active = true;
    this.idle = new Promise((resolve) => { this.resolveIdle = resolve; });
    void this.drain();
  }

  private recordIssue(issue: QueueIssue): void {
    const duplicate = this.issues.some((current) => current.reason === issue.reason && current.sessionId === issue.sessionId);
    if (duplicate) return;
    if (this.issues.length >= MAX_ISSUES) this.issues.shift();
    this.issues.push(issue);
  }

  private async drain(): Promise<void> {
    const failedEntries: QueueEntry[] = [];
    while (this.pending.length !== 0 || this.issues.length !== 0) {
      let entry = this.pending.shift();
      while (entry !== undefined) {
        try {
          await entry.operation();
          entry.resolve({ kind: "processed" });
        } catch (error) {
          failedEntries.push(entry);
          this.recordIssue({ reason: "handler-failed", eventId: entry.options.eventId ?? "queue-handler", ...(entry.options.sessionId === undefined ? {} : { sessionId: entry.options.sessionId }) });
        }
        entry = this.pending.shift();
      }
      if (this.onIssue !== undefined) {
        let issue = this.issues.shift();
        while (issue !== undefined) {
          try {
            await this.onIssue(issue);
          } catch (error) {
            const ignoredDiagnostic = error instanceof Error ? error.name.slice(0, 128) : typeof error;
            void ignoredDiagnostic;
          }
          issue = this.issues.shift();
        }
      } else {
        this.issues.splice(0);
      }
    }
    for (const failedEntry of failedEntries) failedEntry.resolve({ kind: "handler-failed" });
    this.active = false;
    this.resolveIdle?.();
    this.resolveIdle = undefined;
  }
}
