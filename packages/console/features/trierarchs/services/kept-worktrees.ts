import type { ShipId } from '@aeolus-fleet/common';

/** A kept worktree as a clear request names it (decision 0032): its trierarch, the ship it belonged to and its repository. */
export interface KeptWorktreeName {
  trierarchShipId: ShipId;
  shipId: ShipId;
  repository: string;
}

/** Whether a clear request for the kept worktree waits for its trierarch: the console shows it Clearing. */
export function isClearing(pending: readonly KeptWorktreeName[], worktree: KeptWorktreeName): boolean {
  return pending.some((each) => each.trierarchShipId === worktree.trierarchShipId && each.shipId === worktree.shipId && each.repository === worktree.repository);
}
