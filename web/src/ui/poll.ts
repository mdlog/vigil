export const BASE_MS = 15_000;
export const STALE_MS = 60_000;

export function nextDelayMs(failures: number): number {
  return Math.min(60_000, BASE_MS * 2 ** Math.min(failures, 2));
}

export function isStale(lastOkMs: number, nowMs: number): boolean {
  return nowMs - lastOkMs > STALE_MS;
}

/** Runs fn immediately, then again after nextDelayMs(consecutive failures). Returns a stop function. */
export function startPolling(fn: () => Promise<void>, onError: (e: unknown) => void): () => void {
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const tick = async () => {
    try {
      await fn();
      failures = 0;
    } catch (e) {
      failures += 1;
      onError(e);
    }
    if (!stopped) timer = setTimeout(tick, nextDelayMs(failures));
  };
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
