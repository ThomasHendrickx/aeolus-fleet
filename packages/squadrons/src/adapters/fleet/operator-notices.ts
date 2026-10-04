/**
 * Tells argo, the operator of a fleet, when something goes wrong: a plain
 * message from squadrons' management ship of that fleet, which lands in its
 * operator inbox.
 */
import type { FleetDoor, ManagementCrewStore } from '../../core/management/ports.js';
import type { OperatorNotices } from '../../core/squadron/ports.js';

/** The operator ship's name (decision 0012). */
const OPERATOR_SHIP_NAME = 'argo';

export function createOperatorNotices(deps: { door: FleetDoor; management: ManagementCrewStore }): OperatorNotices {
  return {
    tell: async ({ fleetId, text, key }) => {
      const crew = await deps.management.find(fleetId);
      if (!crew) {
        return;
      }
      await deps.door.send(crew.crewToken, {
        selector: { kind: 'ship', name: OPERATOR_SHIP_NAME },
        payload: text,
        contentType: 'text/plain',
        idempotencyKey: `notice-${key}`,
      });
    },
  };
}
