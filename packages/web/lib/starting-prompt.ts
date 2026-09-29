import type { ListedShip } from '@aeolus-fleet/common';

/**
 * True when the ship's valid secret sits in a prompt no session has claimed
 * yet. A new prompt stops that one working, so the console asks first
 * (docs/blueprint.md, "Starting prompt").
 */
export function isUnclaimedPromptOut(ship: Pick<ListedShip, 'startingPrompt'>): boolean {
  return ship.startingPrompt !== null && !ship.startingPrompt.isClaimed;
}
