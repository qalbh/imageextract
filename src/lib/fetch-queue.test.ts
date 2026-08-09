import { describe, expect, it } from 'vitest';
import { createFetchQueue } from './fetch-queue';

// A controllable task: resolves when told to.
function makeTask() {
  let release!: () => void;
  let fail!: (e: Error) => void;
  const gate = new Promise<void>((res, rej) => {
    release = res;
    fail = rej;
  });
  let started = 0;
  let sawAbort = false;
  const run = async (signal: AbortSignal) => {
    started += 1;
    signal.addEventListener('abort', () => {
      sawAbort = true;
      fail(new Error('aborted'));
    });
    await gate;
    return 'done';
  };
  return { run, release, started: () => started, sawAbort: () => sawAbort };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createFetchQueue', () => {
  it('caps concurrency and drains FIFO', async () => {
    const q = createFetchQueue({ maxConcurrent: 2 });
    const tasks = [makeTask(), makeTask(), makeTask(), makeTask()];
    const promises = tasks.map((t, i) => q.enqueue(`k${i}`, 0, t.run));
    await tick();
    expect(tasks.map((t) => t.started())).toEqual([1, 1, 0, 0]);
    expect(q.inFlight()).toBe(2);
    expect(q.pending()).toBe(2);
    tasks[0]!.release();
    await tick();
    expect(tasks[2]!.started()).toBe(1); // FIFO: k2 admitted next
    tasks[1]!.release();
    tasks[2]!.release();
    tasks[3]!.release();
    await expect(Promise.all(promises)).resolves.toEqual(['done', 'done', 'done', 'done']);
    expect(q.inFlight()).toBe(0);
  });

  it('bounds bytes in flight, not just count', async () => {
    const q = createFetchQueue({ maxConcurrent: 4, maxBytesInFlight: 100 });
    const a = makeTask();
    const b = makeTask();
    const c = makeTask();
    q.enqueue('a', 60, a.run);
    q.enqueue('b', 60, b.run); // 60+60 > 100 → must wait despite free slots
    q.enqueue('c', 30, c.run); // FIFO: blocked behind b, not admitted around it
    await tick();
    expect([a.started(), b.started(), c.started()]).toEqual([1, 0, 0]);
    a.release();
    await tick();
    expect([b.started(), c.started()]).toEqual([1, 1]); // 60+30 ≤ 100
    b.release();
    c.release();
  });

  it('always admits one task even when heavier than the whole budget', async () => {
    const q = createFetchQueue({ maxConcurrent: 4, maxBytesInFlight: 100 });
    const huge = makeTask();
    q.enqueue('huge', 5000, huge.run);
    await tick();
    expect(huge.started()).toBe(1); // alone, not deadlocked
    huge.release();
  });

  it('dedupes by key while live', async () => {
    const q = createFetchQueue({ maxConcurrent: 1 });
    const t = makeTask();
    const p1 = q.enqueue('same', 0, t.run);
    const p2 = q.enqueue('same', 0, t.run);
    expect(p1).toBe(p2);
    await tick();
    expect(t.started()).toBe(1);
    t.release();
    await p1;
    // After settling, the key is reusable.
    const t2 = makeTask();
    q.enqueue('same', 0, t2.run);
    await tick();
    expect(t2.started()).toBe(1);
    t2.release();
  });

  it('cancel of a pending task resolves canceled without running it', async () => {
    const q = createFetchQueue({ maxConcurrent: 1 });
    const blocker = makeTask();
    q.enqueue('blocker', 0, blocker.run);
    const victim = makeTask();
    const p = q.enqueue('victim', 0, victim.run);
    q.cancel('victim');
    await expect(p).resolves.toBe('canceled');
    expect(victim.started()).toBe(0);
    blocker.release();
  });

  it('cancel of an active task aborts its signal and frees the slot', async () => {
    const q = createFetchQueue({ maxConcurrent: 1 });
    const t = makeTask();
    const p = q.enqueue('t', 0, t.run);
    await tick();
    const next = makeTask();
    const pNext = q.enqueue('next', 0, next.run);
    q.cancel('t');
    await expect(p).resolves.toBe('canceled');
    expect(t.sawAbort()).toBe(true);
    await tick();
    expect(next.started()).toBe(1); // slot freed
    next.release();
    await pNext;
  });

  it('cancelAll cancels pending and in-flight alike', async () => {
    const q = createFetchQueue({ maxConcurrent: 1 });
    const a = makeTask();
    const b = makeTask();
    const pa = q.enqueue('a', 0, a.run);
    const pb = q.enqueue('b', 0, b.run);
    q.cancelAll();
    await expect(pa).resolves.toBe('canceled');
    await expect(pb).resolves.toBe('canceled');
    expect(b.started()).toBe(0);
  });

  it('a non-abort rejection propagates to the caller', async () => {
    const q = createFetchQueue({ maxConcurrent: 1 });
    const p = q.enqueue('boom', 0, async () => {
      throw new Error('upstream');
    });
    await expect(p).rejects.toThrow('upstream');
  });
});
