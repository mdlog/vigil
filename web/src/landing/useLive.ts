import { useEffect, useState } from 'react';
import type { Snapshot } from '../chain/snapshot';
import { startPolling } from '../ui/poll'; // tiny, and already in the first chunk through view/status

export interface LandingLive { snapshot: Snapshot | null; lastOkMs: number | null; error: string | null }

/** Loads viem and the snapshot reader after the first paint, so the landing's first bundle carries no chain code. */
export function useLive(): LandingLive {
  const [live, setLive] = useState<LandingLive>({ snapshot: null, lastOkMs: null, error: null });
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    Promise.all([import('../chain/client'), import('../chain/snapshot')])
      .then(([{ client }, { readSnapshot }]) => {
        if (cancelled) return;
        stop = startPolling(
          async () => {
            const snapshot = await readSnapshot(client);
            setLive({ snapshot, lastOkMs: Date.now(), error: null });
          },
          (e) => setLive((l) => ({ ...l, error: e instanceof Error ? e.message : String(e) })),
        );
      })
      .catch((e: unknown) => setLive((l) => ({ ...l, error: String(e) })));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return live;
}
