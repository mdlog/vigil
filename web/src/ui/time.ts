const ET = 'America/New_York';

export const REGIME_NAMES = ['MARKET', 'EXTENDED', 'OVERNIGHT', 'CLOSED', 'CORP_ACTION'] as const;

const clockFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ET, weekday: 'short', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
const zoneFmt = new Intl.DateTimeFormat('en-US', { timeZone: ET, timeZoneName: 'short' });

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** "Sat, Sep 19 · 00:08:25 ET" */
export function etClock(tsMs: number): string {
  const p = clockFmt.formatToParts(new Date(tsMs));
  const hour = part(p, 'hour') === '24' ? '00' : part(p, 'hour');
  return `${part(p, 'weekday')}, ${part(p, 'month')} ${part(p, 'day')} · ${hour}:${part(p, 'minute')}:${part(p, 'second')} ET`;
}

/** "Mon Sep 21, 09:30 ET" */
export function etDateTime(tsSec: number): string {
  const p = dateTimeFmt.formatToParts(new Date(tsSec * 1000));
  const hour = part(p, 'hour') === '24' ? '00' : part(p, 'hour');
  return `${part(p, 'weekday')} ${part(p, 'month')} ${part(p, 'day')}, ${hour}:${part(p, 'minute')} ET`;
}

export function etOffsetLabel(tsMs: number): 'EDT' | 'EST' {
  return part(zoneFmt.formatToParts(new Date(tsMs)), 'timeZoneName') === 'EDT' ? 'EDT' : 'EST';
}

export function countdown(nowSec: number, targetSec: number): number {
  return Math.max(0, targetSec - nowSec);
}
