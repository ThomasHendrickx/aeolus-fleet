import { SCOPES, type FleetId, type Scope, type ShipId, type ShipKind } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

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

type Permanent = DomainError<'OPERATOR_SHIP_IS_PERMANENT'>;
type Reserved = DomainError<'SHIP_NAME_RESERVED'>;

/** Commissioning and renaming call this: no ship but the operator ship may be called `argo`. */
export function checkNameIsNotReserved(name: string): Result<void, Reserved> {
  return isReservedShipName(name)
    ? refuse('SHIP_NAME_RESERVED', `The name ${OPERATOR_SHIP_NAME} is reserved for the operator ship`)
    : ok(undefined);
}

export function checkCanRetire(ship: Ship): Result<void, Permanent> {
  return checkNotOperatorShip(ship, 'retired');
}

export function checkCanRelease(ship: Ship): Result<void, Permanent> {
  return checkNotOperatorShip(ship, 'released');
}

export function checkCanRename(ship: Ship, newName: string): Result<void, Permanent | Reserved> {
  const permanent = checkNotOperatorShip(ship, 'renamed');
  return permanent.isOk ? checkNameIsNotReserved(newName) : permanent;
}

function checkNotOperatorShip(ship: Ship, action: 'retired' | 'released' | 'renamed'): Result<void, Permanent> {
  return ship.kind === 'operator'
    ? refuse('OPERATOR_SHIP_IS_PERMANENT', `${ship.name} is the operator ship and can never be ${action}`)
    : ok(undefined);
}
