import { useEffect, useState } from 'react';

/** The wall clock, re-read every `intervalMs` — drives countdowns and "last read … ago". */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
