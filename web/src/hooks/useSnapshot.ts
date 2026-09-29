import { useEffect, useRef, useState } from 'react';
import { client } from '../chain/client';
import { readMarketParams, type MarketParams } from '../chain/account';
import { readCurve, type CurvePoint } from '../chain/curve';
import { readSnapshot, type Snapshot } from '../chain/snapshot';
import type { Market } from '../deployment';
import { startPolling } from '../ui/poll';

export interface Live { snapshot: Snapshot | null; curve: CurvePoint[]; params: MarketParams | null; lastOkMs: number | null; error: string | null }

/** The dashboard's one read loop: a snapshot every poll (15 s; `?poll=` shortens it), the market params once, and
 *  the on-chain curve again only when the haircut surface changes. Backoff and `?rpc=` come from ui/poll and chain/client. */
export function useSnapshot(m: Market): Live {
  const [live, setLive] = useState<Live>({ snapshot: null, curve: [], params: null, lastOkMs: null, error: null });
  const surfaceKey = useRef('');
  const params = useRef<MarketParams | null>(null);
  useEffect(() => {
    // another market starts from nothing: its snapshot, curve and params are its own
    setLive({ snapshot: null, curve: [], params: null, lastOkMs: null, error: null });
    surfaceKey.current = '';
    params.current = null;
    let gone = false; // a read still in flight for the previous market must not land on this one
    const stop = startPolling(
      async () => {
        const snapshot = await readSnapshot(client, m);
        const p = params.current ?? (await readMarketParams(client, m));
        if (gone) return;
        params.current = p;
        setLive((l) => ({ ...l, snapshot, params: p, lastOkMs: Date.now(), error: null }));
        const key = `${snapshot.surface.sigmaGapWad}-${snapshot.surface.kTailBps}-${snapshot.surface.hFloorBps}-${snapshot.surface.hMaxBps}`;
        if (key !== surfaceKey.current) {
          const curve = await readCurve(client, snapshot.surface);
          if (gone) return;
          surfaceKey.current = key;
          setLive((l) => ({ ...l, curve }));
        }
      },
      (e) => {
        if (!gone) setLive((l) => ({ ...l, error: e instanceof Error ? e.message : String(e) }));
      },
    );
    return () => {
      gone = true;
      stop();
    };
  }, [m]);
  return live;
}
