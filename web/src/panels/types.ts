import type { Snapshot } from '../chain/snapshot';
export interface Meta { nowMs: number; lastOkMs: number | null; error: string | null }
export interface Panel { root: HTMLElement; render(s: Snapshot | null, meta: Meta): void }
