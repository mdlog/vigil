import { useEffect, useRef, useState } from 'react';
import { client } from '../chain/client';
import { readMarketParams, type MarketParams } from '../chain/account';
import { readCurve, type CurvePoint } from '../chain/curve';
import { readSnapshot, type Snapshot } from '../chain/snapshot';
import { startPolling } from '../ui/poll';

export interface Live { snapshot: Snapshot | null; curve: CurvePoint[]; params: MarketParams | null; lastOkMs: number | null; error: string | null }

/** The dashboard's one read loop: a snapshot every poll (15 s; `?poll=` shortens it), the market params once, and
 *  the on-chain curve again only when the haircut surface changes. Backoff and `?rpc=` come from ui/poll and chain/client. */
export function useSnapshot(): Live {
  const [live, setLive] = useState<Live>({ snapshot: null, curve: [], params: null, lastOkMs: null, error: null });
  const surfaceKey = useRef('');
  const params = useRef<MarketParams | null>(null);
  useEffect(
    () =>
      startPolling(
        async () => {
          const snapshot = await readSnapshot(client);
          params.current ??= await readMarketParams(client);
          setLive((l) => ({ ...l, snapshot, params: params.current, lastOkMs: Date.now(), error: null }));
          const key = `${snapshot.surface.sigmaGapWad}-${snapshot.surface.kTailBps}-${snapshot.surface.hFloorBps}-${snapshot.surface.hMaxBps}`;
          if (key !== surfaceKey.current) {
            const curve = await readCurve(client, snapshot.surface);
            surfaceKey.current = key;
            setLive((l) => ({ ...l, curve }));
          }
        },
        (e) => setLive((l) => ({ ...l, error: e instanceof Error ? e.message : String(e) })),
      ),
    [],
  );
  return live;
}
