import type { ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal, ManagementCrewStore, OutgoingMessage, ReceivedMessage } from '../management/ports.js';
import { err, ok, type Result } from '../shared/result.js';
import { ARGO_NAME } from './proxy-messages.js';
import type { Squadron } from './squadron.js';

/** The squadron's one contact outside it: argo, or a ship by id. */
export type Contact = { kind: 'argo' } | { kind: 'ship'; shipId: ShipId };

/**
 * The squadron's contact now (decision 0017, 0.R): argo for a squadron argo
 * formed; its forming ship while that ship is not retired; once it is, the
 * forming ship's owner as the fleet names it while the owner is not retired,
 * argo when it names none or the owner is retired. Read from the fleet as
 * squadrons' own ship, so an owner argo changed or retired counts at once; a
 * read that fails is a refusal, to try again, never argo by default.
 */
export async function contactOf(
  deps: { door: Pick<FleetDoor, 'getShip'>; management: Pick<ManagementCrewStore, 'find'> },
  squadron: Squadron,
): Promise<Result<Contact, FleetRefusal>> {
  if (squadron.formingShip === null) {
    return ok({ kind: 'argo' });
  }
  const crew = await deps.management.find(squadron.fleetId);
  if (!crew) {
    return err({ code: 'NOT_CONNECTED', message: 'squadrons is not connected to this fleet' });
  }
  const forming = await deps.door.getShip(crew.crewToken, { shipId: squadron.formingShip.shipId });
  if (!forming.isOk) {
    return forming;
  }
  if (forming.value.status !== 'retired') {
    return ok({ kind: 'ship', shipId: squadron.formingShip.shipId });
  }
  const { ownerShipId } = forming.value;
  if (ownerShipId === null) {
    return ok({ kind: 'argo' });
  }
  const owner = await deps.door.getShip(crew.crewToken, { shipId: ownerShipId });
  if (!owner.isOk) {
    return owner;
  }
  return ok(owner.value.status === 'retired' ? { kind: 'argo' } : { kind: 'ship', shipId: ownerShipId });
}

/** Where a message to the contact goes. */
export function contactSelector(contact: Contact): OutgoingMessage['selector'] {
  return contact.kind === 'argo' ? { kind: 'ship', name: ARGO_NAME } : { kind: 'ship', shipId: contact.shipId };
}

/** Whether the delivery comes from the contact. */
export function isFromContact(contact: Contact, delivery: Pick<ReceivedMessage, 'senderShipId' | 'senderName'>): boolean {
  return contact.kind === 'argo' ? delivery.senderName === ARGO_NAME : delivery.senderShipId === contact.shipId;
}
