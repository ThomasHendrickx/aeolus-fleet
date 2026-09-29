import { SCOPES, type FleetId, type Scope, type ShipId, type ShipKind } from '@aeolus-fleet/common';

import { DomainError } from '../shared/errors.js';

/** A durable, addressable identity with an inbox. Outlives any session. */
export interface Ship {
  id: ShipId;
  fleetId: FleetId;
  name: string;
  type: string;
  kind: ShipKind;
  scopes: readonly Scope[];
  note: string | null;
  createdAt: Date;
  retiredAt: Date | null;
}

/** The operator ship's name. Reserved: no other ship can take it. */
export const OPERATOR_SHIP_NAME = 'argo';

/** The operator ship's type label, the same word as its kind. */
export const OPERATOR_SHIP_TYPE = 'operator';

/** `argo`: the one ship of kind `operator`, holding every scope (ADR 0012). */
export function operatorShip(input: { id: ShipId; fleetId: FleetId; createdAt: Date }): Ship {
  return {
    ...input,
    name: OPERATOR_SHIP_NAME,
    type: OPERATOR_SHIP_TYPE,
    kind: 'operator',
    scopes: [...SCOPES],
    note: null,
    retiredAt: null,
  };
}

export function isReservedShipName(name: string): boolean {
  return name === OPERATOR_SHIP_NAME;
}

/** Commissioning and renaming call this: no ship but the operator ship may be called `argo`. */
export function assertNameIsNotReserved(name: string): void {
  if (isReservedShipName(name)) {
    throw new DomainError('SHIP_NAME_RESERVED', `The name ${OPERATOR_SHIP_NAME} is reserved for the operator ship`);
  }
}

export function assertCanRetire(ship: Ship): void {
  assertNotOperatorShip(ship, 'retired');
}

export function assertCanRelease(ship: Ship): void {
  assertNotOperatorShip(ship, 'released');
}

export function assertCanRename(ship: Ship, newName: string): void {
  assertNotOperatorShip(ship, 'renamed');
  assertNameIsNotReserved(newName);
}

function assertNotOperatorShip(ship: Ship, action: 'retired' | 'released' | 'renamed'): void {
  if (ship.kind === 'operator') {
    throw new DomainError('OPERATOR_SHIP_IS_PERMANENT', `${ship.name} is the operator ship and can never be ${action}`);
  }
}
