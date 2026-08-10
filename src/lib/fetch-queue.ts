/**
 * Bounded request queue — the shared substrate for byte-size probing (HEADs,
 * Phase 3 step 3) and ZIP assembly (GET streams, step 4). It bounds BOTH
 * concurrent request count and announced bytes in flight, because step 4's
 * cargo is 50 MB streams where a count cap alone would put 300 MB in the air
 * on a phone. Probes enqueue weight 0, so only the count bound governs them;
 * step 4's GETs enqueue their announced size (learned from these probes) and
 * the byte bound governs admission.
 *
 * Deliberately NOT here: progress events, priorities, retries — step 4 adds
 * what it needs inside its run() callbacks, around the queue, not into it.
 */

interface Task {
  key: string;
  weight: number;
  run: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  promise: Promise<unknown>;
  controller: AbortController | null; // null until admitted
}

export interface FetchQueue {
  /**
   * Enqueue a task. Re-enqueueing a live key returns the existing task's
   * promise (dedupe). Resolves 'canceled' if the task is canceled before or
   * during flight; rejects only if run() rejects for a non-abort reason.
   */
  enqueue<T>(key: string, weightBytes: number, run: (signal: AbortSignal) => Promise<T>): Promise<T | 'canceled'>;
  /**
   * Correct an ACTIVE task's weight once its true size is known (e.g. a ZIP
   * member admitted at the blind default learns its Content-Length from the
   * response headers). Adjusts the in-flight byte accounting in both
   * directions — downward frees budget for waiting tasks immediately; upward
   * blocks further admissions, capping a blind-admission overshoot to one
   * scheduling round. No effect on pending or settled keys.
   */
  setWeight(key: string, weightBytes: number): void;
  cancel(key: string): void;
  cancelAll(): void;
  inFlight(): number;
  pending(): number;
}

export function createFetchQueue(options: {
  maxConcurrent: number;
  maxBytesInFlight?: number;
}): FetchQueue {
  const maxBytes = options.maxBytesInFlight ?? Number.POSITIVE_INFINITY;
  const waiting: Task[] = [];
  const active = new Map<string, Task>();
  // Live keys across both states, for dedupe.
  const byKey = new Map<string, Task>();
  let activeBytes = 0;

  function admit(): void {
    while (waiting.length > 0 && active.size < options.maxConcurrent) {
      const next = waiting[0] as Task;
      // Byte-budget admission, with the always-admit-one rule: a single task
      // heavier than the whole budget must still run (alone) rather than
      // deadlock the queue.
      if (active.size > 0 && activeBytes + next.weight > maxBytes) break;
      waiting.shift();
      const controller = new AbortController();
      next.controller = controller;
      active.set(next.key, next);
      activeBytes += next.weight;
      // Bookkeeping must complete BEFORE the caller's promise settles — a
      // .finally would race the caller's await, and an immediate re-enqueue
      // of the same key could then dedupe against the already-settled task.
      const cleanup = () => {
        active.delete(next.key);
        activeBytes -= next.weight;
        byKey.delete(next.key);
      };
      next.run(controller.signal).then(
        (value) => {
          cleanup();
          next.resolve(value);
          admit();
        },
        (error) => {
          cleanup();
          if (controller.signal.aborted) next.resolve('canceled');
          else next.reject(error);
          admit();
        },
      );
    }
  }

  function settle(task: Task): void {
    byKey.delete(task.key);
    task.resolve('canceled');
  }

  return {
    enqueue(key, weightBytes, run) {
      const existing = byKey.get(key);
      if (existing) return existing.promise as Promise<never>;
      let resolve!: (v: unknown) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const task: Task = { key, weight: weightBytes, run: run as Task['run'], resolve, reject, promise, controller: null };
      byKey.set(key, task);
      waiting.push(task);
      admit();
      // The internal store is untyped (Task holds unknown); the public
      // signature narrows it back to the caller's T.
      return promise as Promise<never>;
    },
    setWeight(key, weightBytes) {
      const task = active.get(key);
      if (!task) return;
      activeBytes += weightBytes - task.weight;
      task.weight = weightBytes;
      admit(); // a downward correction may unblock waiting tasks
    },
    cancel(key) {
      const task = byKey.get(key);
      if (!task) return;
      const idx = waiting.indexOf(task);
      if (idx !== -1) {
        waiting.splice(idx, 1);
        settle(task);
        return;
      }
      // Active: abort — the run's rejection resolves it 'canceled' above.
      task.controller?.abort();
    },
    cancelAll() {
      while (waiting.length > 0) settle(waiting.pop() as Task);
      for (const task of active.values()) task.controller?.abort();
    },
    inFlight: () => active.size,
    pending: () => waiting.length,
  };
}
