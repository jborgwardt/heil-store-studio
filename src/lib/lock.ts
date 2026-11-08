let chain: Promise<unknown> = Promise.resolve();
let active = 0;

export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const guarded = async () => {
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
    }
  };
  const run = chain.then(guarded, guarded);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** A locked write is running (reads should not reset the working tree under it). */
export function lockBusy(): boolean {
  return active > 0;
}
