export const BASE_MS = 15_000;
export const STALE_MS = 60_000;

/** `?poll=4000` shortens the interval (floor 2 s) — used when filming the page while a script runs. */
export function pollBaseMs(search: string = typeof location !== 'undefined' ? location.search : ''): number {
  const v = Number(new URLSearchParams(search).get('poll'));
  return Number.isFinite(v) && v >= 2000 ? v : BASE_MS;
}

export function nextDelayMs(failures: number, baseMs: number = BASE_MS): number {
  return Math.min(60_000, baseMs * 2 ** Math.min(failures, 2));
}

export function isStale(lastOkMs: number, nowMs: number): boolean {
  return nowMs - lastOkMs > STALE_MS;
}

/** Runs fn immediately, then again after nextDelayMs(consecutive failures). Returns a stop function. */
export function startPolling(fn: () => Promise<void>, onError: (e: unknown) => void, baseMs: number = pollBaseMs()): () => void {
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
    if (!stopped) timer = setTimeout(tick, nextDelayMs(failures, baseMs));
  };
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
