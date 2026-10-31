/** How many report intervals may pass before a trierarch's activity write reads as unknown (docs/design/monitoring, N4). */
const UNKNOWN_AFTER_INTERVALS = 2;

const SECOND_MS = 1000;

/**
 * Whether a ship's activity reads unknown at `now`: its trierarch wrote it
 * longer ago than twice the report interval it stated with the write, so the
 * trierarch is likely down (docs/design/monitoring, 4.3). Unknown is never
 * stopped work.
 */
export function isActivityUnknown(written: { reportedAt: Date; intervalSeconds: number }, now: Date): boolean {
  return now.getTime() - written.reportedAt.getTime() > UNKNOWN_AFTER_INTERVALS * written.intervalSeconds * SECOND_MS;
}
