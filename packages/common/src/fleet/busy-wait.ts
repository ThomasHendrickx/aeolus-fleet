/**
 * The wait before the next call while the fleet answers busy: drawn between
 * half and all of `waitMs`, so callers the fleet refused together do not call
 * again together. `random` draws in [0, 1], as Math.random does.
 */
export function busyWaitMs(waitMs: number, random: () => number): number {
  const half = waitMs / 2;
  return half + random() * half;
}
