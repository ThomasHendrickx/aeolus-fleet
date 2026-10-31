import type { ActivityKind } from '@aeolus-fleet/common';

/**
 * What the assigned trierarch last observed of the session crewing a ship
 * (docs/design/monitoring, 4.3): its latest event's time and kind, the tool
 * of a tool call, never content; when the trierarch wrote it, and the report
 * interval it stated, so a reader tells when it reads unknown. It belongs to
 * the lease: the ship's next crew starts with none.
 */
export interface LeaseActivity {
  at: Date;
  kind: ActivityKind;
  tool: string | null;
  reportedAt: Date;
  intervalSeconds: number;
}
