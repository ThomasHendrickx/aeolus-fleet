/**
 * Tells argo, the operator of a fleet, when something goes wrong: a message
 * from squadrons' management ship of that fleet, shaped as the ship protocol
 * shapes a message to argo, which lands in its operator inbox.
 */
import { argoMessage, MARKDOWN_CONTENT_TYPE } from '@aeolus-fleet/common';

import type { FleetDoor, ManagementCrewStore } from '../../core/management/ports.js';
import type { OperatorNotices } from '../../core/squadron/ports.js';

/** The operator ship's name (decision 0012). */
const OPERATOR_SHIP_NAME = 'argo';

export function createOperatorNotices(deps: { door: FleetDoor; management: ManagementCrewStore }): OperatorNotices {
  return {
    tell: async ({ fleetId, headline, body, key }) => {
      const crew = await deps.management.find(fleetId);
      if (!crew) {
        return;
      }
      await deps.door.send(crew.crewToken, {
        selector: { kind: 'ship', name: OPERATOR_SHIP_NAME },
        payload: argoMessage({ headline, body }),
        contentType: MARKDOWN_CONTENT_TYPE,
        idempotencyKey: `notice-${key}`,
      });
    },
  };
}
