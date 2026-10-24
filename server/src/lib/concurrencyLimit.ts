/** Runs `task` once a slot is free; resolves or rejects with the task's result. */
export type ConcurrencyLimit = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * A gate shared across callers: at most `max` tasks run at once, and the rest
 * wait in arrival order. Unlike registryFanout's runWithConcurrency, which
 * works through one fixed list, this limits work that arrives over time from
 * independent requests.
 */
export function createConcurrencyLimit(max: number): ConcurrencyLimit {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`concurrency limit must be a positive integer, got ${max}`);
  }

  let running = 0;
  const waiting: Array<() => void> = [];

  // A finished task hands its slot straight to the next waiter (running stays
  // the same), so a newcomer cannot take the slot in between and push the
  // count past `max`.
  function release(): void {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (running < max) running++;
    else await new Promise<void>(resolve => waiting.push(resolve));

    try {
      return await task();
    } finally {
      release();
    }
  };
}
