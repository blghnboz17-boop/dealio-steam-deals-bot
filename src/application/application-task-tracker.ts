export class ApplicationTaskTracker {
  private readonly tasks = new Set<Promise<void>>();
  private stopping = false;
  private stopPromise: Promise<void> | null = null;

  public run(operation: () => Promise<void>): boolean {
    if (this.stopping) {
      return false;
    }

    const task = operation();
    this.tasks.add(task);
    const removeTask = (): void => {
      this.tasks.delete(task);
    };
    void task.then(removeTask, removeTask);
    return true;
  }

  public stop(): Promise<void> {
    if (this.stopPromise === null) {
      this.stopping = true;
      this.stopPromise = Promise.allSettled([...this.tasks]).then(() => undefined);
    }

    return this.stopPromise;
  }
}
