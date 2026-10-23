import { readsShip, type ReadReachOf, type ShipRepository } from '../registry/public.js';
import { isShipCaller, type Caller } from './caller.js';
import type { ShipHistory } from './history.js';

export type CountOpenInbox = (caller: Caller) => Promise<{ open: number }>;

/**
 * Use case: how many messages wait open in the caller's own inbox, for the
 * navigation and the Open segment of argo's inbox (docs/blueprint.md,
 * "Inbox"), counted in one query rather than from the pages read. A viewer
 * session or an account holding fleet:read counts argo's, as it reads it
 * (decision 0034): every one while its read reach reads argo, otherwise only
 * those whose sender it reads. The caller's scope (fleet:read) is checked
 * before this runs.
 */
export function createCountOpenInbox(deps: { history: ShipHistory; ships: Pick<ShipRepository, 'findOperatorShip'>; readReach: ReadReachOf }): CountOpenInbox {
  return async (caller) => {
    if (isShipCaller(caller) && caller.kind !== 'viewer') {
      return { open: await deps.history.openInboxCount(caller.fleetId, { shipId: caller.shipId }) };
    }
    const argo = await deps.ships.findOperatorShip(caller.fleetId);
    if (!argo) {
      return { open: 0 };
    }
    const reach = await deps.readReach(caller);
    const senderIds = reach.kind === 'some' && !readsShip(reach, argo.id) ? reach.shipIds : undefined;
    return { open: await deps.history.openInboxCount(caller.fleetId, { shipId: argo.id, senderIds }) };
  };
}
