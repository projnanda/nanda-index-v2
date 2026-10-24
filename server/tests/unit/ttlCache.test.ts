import { describe, it, expect } from 'vitest';
import { cacheFor } from '../../src/lib/ttlCache.js';

/** A loader that counts its calls and resolves to the call number. */
function countingLoader(): { load: () => Promise<number>; calls: () => number } {
  let calls = 0;
  return {
    load: async () => ++calls,
    calls: () => calls,
  };
}

/** A clock the test moves by hand. */
function fakeClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('cacheFor', () => {
  it('reuses the loaded value until the TTL passes, then loads again', async () => {
    const clock = fakeClock();
    const { load, calls } = countingLoader();
    const cached = cacheFor(60_000, load, clock.now);

    expect(await cached()).toBe(1);
    clock.advance(59_999);
    expect(await cached()).toBe(1);
    expect(calls()).toBe(1);

    clock.advance(1);
    expect(await cached()).toBe(2);
    expect(calls()).toBe(2);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const { load, calls } = countingLoader();
    const cached = cacheFor(60_000, load);

    const results = await Promise.all([cached(), cached(), cached()]);

    expect(results).toEqual([1, 1, 1]);
    expect(calls()).toBe(1);
  });

  it('does not keep a failed load: the next caller retries', async () => {
    let attempt = 0;
    const cached = cacheFor(60_000, async () => {
      attempt++;
      if (attempt === 1) throw new Error('db down');
      return attempt;
    });

    await expect(cached()).rejects.toThrow('db down');
    expect(await cached()).toBe(2);
    expect(await cached()).toBe(2);
  });

  it('starts a fresh load once the TTL passes, even if the old one is still running', async () => {
    const clock = fakeClock();
    const pending: Array<() => void> = [];
    let calls = 0;
    const cached = cacheFor(60_000, () => {
      const call = ++calls;
      return new Promise<number>((resolve) => { pending.push(() => resolve(call)); });
    }, clock.now);

    const first = cached();
    clock.advance(60_000);
    const second = cached();
    pending.forEach((settle) => settle());

    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(await cached()).toBe(2);
  });

  it('keeps the newer entry when an older, expired load fails late', async () => {
    const clock = fakeClock();
    const settlers: Array<{ resolve: (n: number) => void; reject: (e: Error) => void }> = [];
    const cached = cacheFor(60_000, () =>
      new Promise<number>((resolve, reject) => { settlers.push({ resolve, reject }); }), clock.now);

    const stale = cached();
    clock.advance(60_000);
    const fresh = cached();
    settlers[1]!.resolve(2);
    settlers[0]!.reject(new Error('timed out'));

    await expect(stale).rejects.toThrow('timed out');
    expect(await fresh).toBe(2);
    expect(await cached()).toBe(2);
    expect(settlers).toHaveLength(2);
  });

  it('turns caching off when the TTL is 0', async () => {
    const { load, calls } = countingLoader();
    const cached = cacheFor(0, load);

    expect(await cached()).toBe(1);
    expect(await cached()).toBe(2);
    expect(calls()).toBe(2);
  });

  it('rejects a negative or fractional TTL', () => {
    const { load } = countingLoader();
    expect(() => cacheFor(-1, load)).toThrow(RangeError);
    expect(() => cacheFor(1.5, load)).toThrow(RangeError);
  });
});
