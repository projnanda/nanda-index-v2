import { performance } from 'node:perf_hooks';

interface CacheEntry<T> {
  readonly value: Promise<T>;
  readonly expiresAt: number;
}

/**
 * Wraps an async loader so its result is reused for `ttlMs`. Callers that
 * arrive while a load is still running share it, so when the entry expires
 * under load the query runs once, not once per waiting request. A failed load
 * is not kept: the next caller tries again. `ttlMs` = 0 turns caching off.
 *
 * Every caller gets the same value, so loaders should return frozen data.
 * The default clock is monotonic: a wall-clock step back cannot stretch a TTL.
 */
export function cacheFor<T>(
  ttlMs: number,
  load: () => Promise<T>,
  now: () => number = () => performance.now(),
): () => Promise<T> {
  if (!Number.isInteger(ttlMs) || ttlMs < 0) {
    throw new RangeError(`cache TTL must be a non-negative integer, got ${ttlMs}`);
  }
  if (ttlMs === 0) return load;

  let entry: CacheEntry<T> | null = null;

  return function cached(): Promise<T> {
    const startedAt = now();
    if (entry && startedAt < entry.expiresAt) return entry.value;

    const current: CacheEntry<T> = { value: load(), expiresAt: startedAt + ttlMs };
    entry = current;
    // Only drop the entry this load created; a newer one may have replaced it.
    current.value.catch(() => {
      if (entry === current) entry = null;
    });
    return current.value;
  };
}
