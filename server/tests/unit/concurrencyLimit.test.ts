import { describe, it, expect } from 'vitest';
import { createConcurrencyLimit } from '../../src/lib/concurrencyLimit.js';

/** A promise plus the function that settles it, so a test decides when a task finishes. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('createConcurrencyLimit', () => {
  it('runs at most `max` tasks at once, starting waiters in arrival order', async () => {
    const limit = createConcurrencyLimit(2);
    const gates = [gate(), gate(), gate(), gate()];
    const started: number[] = [];
    const runs = gates.map((g, i) => limit(async () => {
      started.push(i);
      await g.promise;
      return i;
    }));

    await settle();
    expect(started).toEqual([0, 1]);

    gates[1]!.open();
    await settle();
    expect(started).toEqual([0, 1, 2]);

    gates[0]!.open();
    await settle();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[2]!.open();
    gates[3]!.open();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
  });

  it('frees the slot when a task throws', async () => {
    const limit = createConcurrencyLimit(1);
    await expect(limit(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await limit(async () => 'next')).toBe('next');
  });

  it('rejects a limit below 1', () => {
    expect(() => createConcurrencyLimit(0)).toThrow(RangeError);
    expect(() => createConcurrencyLimit(1.5)).toThrow(RangeError);
  });
});
