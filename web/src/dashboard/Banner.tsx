import type { SyncStatus } from '../view/status';

const etTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });

/** Says so when the RPC stops answering. The recorder refuses to film while "RPC unreachable" is on the page. */
export function Banner({ status, error, lastOkMs }: { status: SyncStatus; error: string | null; lastOkMs: number | null }) {
  if (status === 'offline') return <div className="dashboard-banner" role="alert">RPC unreachable — no data yet, retrying ({error?.split('\n')[0]})</div>;
  if (error === null || lastOkMs === null) return null;
  return <div className="dashboard-banner" role="status">RPC unreachable — showing data fetched {etTime(lastOkMs)} ET</div>;
}
