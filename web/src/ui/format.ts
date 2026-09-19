export function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(2)} %`;
}

export function fmtPct(x: number, digits = 2): string {
  return `${(x * 100).toFixed(digits)} %`;
}

/** Morpho oracle price (1e36 × 10^(6 − 18) = 1e24 scale) → USDG per NVDA. */
export function priceToUsdg(p: bigint): number {
  return Number(p / 10n ** 12n) / 1e12;
}

export function feedToUsd(a: bigint): number {
  return Number(a) / 1e8;
}

export function usdg6(x: bigint): number {
  return Number(x) / 1e6;
}

/** Δindex (WAD per unit notional) → USDG owed per 1 000 USDG of debt. */
export function premiumPer1000(deltaIndex: bigint): number {
  return Number(deltaIndex) / 1e15;
}

export function fmtUsd(n: number, digits = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtCompactUsdg(n: number): string {
  return fmtUsd(n, 0);
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s === 0) return '0s';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => n.toString().padStart(2, '0');
  if (d > 0) return `${d}d ${h}h ${two(m)}m`;
  if (h > 0) return `${h}h ${two(m)}m ${two(sec)}s`;
  return `${m}m ${two(sec)}s`;
}

export function fmtAge(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${(s / 60).toFixed(1)} min ago`;
  if (s < 48 * 3600) return `${(s / 3600).toFixed(1)} h ago`;
  return `${(s / 86400).toFixed(1)} d ago`;
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
