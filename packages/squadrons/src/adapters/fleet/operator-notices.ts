/**
 * Tells argo, the operator, when something goes wrong: a plain message from
 * squadrons' management ship, which lands in the operator inbox.
 */
import { randomUUID } from 'node:crypto';

import type { FleetDoor, ManagementCrewStore } from '../../core/management/ports.js';
import type { OperatorNotices } from '../../core/squadron/ports.js';

/** The operator ship's name (decision 0012). */
const OPERATOR_SHIP_NAME = 'argo';

export function createOperatorNotices(deps: { door: FleetDoor; management: ManagementCrewStore }): OperatorNotices {
  return {
    tell: async (text) => {
      const crew = await deps.management.find();
      if (!crew) {
        return;
      }
      await deps.door.send(crew.crewToken, {
        selector: { kind: 'ship', name: OPERATOR_SHIP_NAME },
        payload: text,
        contentType: 'text/plain',
        idempotencyKey: `notice-${randomUUID()}`,
      });
    },
  };
}
