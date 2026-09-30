import { createIdGenerator, type FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { ok } from '../shared/result.js';
import type { Lease } from './lease.js';
import {
  checkCanRelease,
  claimShip,
  checkCanRename,
  checkCanRetire,
  checkNameIsNotReserved,
  isReservedShipName,
  operatorShip,
  shipStatus,
  type Ship,
} from './ship.js';

const newId = createIdGenerator();
const fleetId: FleetId = newId('fleet');
const createdAt = new Date('2026-09-29T12:00:00.000Z');

const argo = operatorShip({ id: newId('ship'), fleetId, createdAt });
const scout: Ship = {
  id: newId('ship'),
  fleetId,
  name: 'scout',
  type: 'reviewer',
  kind: 'agent',
  scopes: ['messages:send', 'messages:receive'],
  note: null,
  createdAt,
  retiredAt: null,
};

const allowed = { isOk: true, value: undefined };

const claimedAt = new Date('2026-09-30T08:00:00.000Z');

/** A session's claim: a new lease id, where it runs, and the hash of its crew token. */
function aClaim() {
  return {
    leaseId: newId('lease'),
    location: { kind: 'CLOUD' as const, description: null },
    crewTokenHash: 'sha256(aeolus_ct_v1_crew)',
    at: claimedAt,
  };
}

function aLeaseOn(ship: Ship): Lease {
  return {
    id: newId('lease'),
    fleetId,
    shipId: ship.id,
    location: { kind: 'DEVICE', description: null },
    crewTokenHash: 'sha256(aeolus_ct_v1_first)',
    startedAt: createdAt,
    endedAt: null,
  };
}

describe('the operator ship', () => {
  it('is argo, of kind operator and type operator, holding every scope', () => {
    expect(argo).toMatchObject({
      name: 'argo',
      type: 'operator',
      kind: 'operator',
      scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'],
      retiredAt: null,
    });
  });

  it('can never be retired', () => {
    expect(checkCanRetire(argo)).toEqual({
      isOk: false,
      error: { kind: 'OPERATOR_SHIP_IS_PERMANENT', message: 'argo is the operator ship and can never be retired' },
    });
  });

  it('can never be released', () => {
    expect(checkCanRelease(argo)).toEqual({
      isOk: false,
      error: { kind: 'OPERATOR_SHIP_IS_PERMANENT', message: 'argo is the operator ship and can never be released' },
    });
  });

  it('can never be renamed', () => {
    expect(checkCanRename(argo, 'helm')).toEqual({
      isOk: false,
      error: { kind: 'OPERATOR_SHIP_IS_PERMANENT', message: 'argo is the operator ship and can never be renamed' },
    });
  });

  it("refuses a secret claim: it has no secret, and only the operator's sign-in crews it", () => {
    expect(claimShip({ ship: argo, heldLease: undefined }, aClaim())).toEqual({
      isOk: false,
      error: {
        kind: 'OPERATOR_SHIP_HAS_NO_SECRET',
        message: "argo has no secret: only the operator's console sign-in crews it",
      },
    });
  });
});

describe('an agent ship', () => {
  it('can be retired, released and renamed', () => {
    expect(checkCanRetire(scout)).toEqual(allowed);
    expect(checkCanRelease(scout)).toEqual(allowed);
    expect(checkCanRename(scout, 'lookout')).toEqual(allowed);
  });

  it('can be claimed with its secret', () => {
    expect(claimShip({ ship: scout, heldLease: undefined }, aClaim())).toMatchObject({ isOk: true });
  });

  it('can never be renamed to argo', () => {
    expect(checkCanRename(scout, 'argo')).toMatchObject({ isOk: false, error: { kind: 'SHIP_NAME_RESERVED' } });
  });
});

describe('the reserved name', () => {
  it('is argo', () => {
    expect(isReservedShipName('argo')).toBe(true);
    expect(checkNameIsNotReserved('argo')).toEqual({
      isOk: false,
      error: { kind: 'SHIP_NAME_RESERVED', message: 'The name argo is reserved for the operator ship' },
    });
  });

  it.each(['scout', 'argo-2', 'argonaut'])('leaves %s free', (name) => {
    expect(isReservedShipName(name)).toBe(false);
    expect(checkNameIsNotReserved(name)).toEqual(allowed);
  });
});

describe('the status of a ship', () => {
  it('is awaiting crew while no session holds its lease', () => {
    expect(shipStatus(scout, { isCrewed: false })).toBe('awaitingCrew');
  });

  it('is crewed while a session holds its lease', () => {
    expect(shipStatus(scout, { isCrewed: true })).toBe('crewed');
  });

  it('is retired once retired, whatever its lease says', () => {
    const retired = { ...scout, retiredAt: createdAt };

    expect(shipStatus(retired, { isCrewed: false })).toBe('retired');
    expect(shipStatus(retired, { isCrewed: true })).toBe('retired');
  });
});

describe('claiming a ship with its secret', () => {
  it('opens a lease at the reported location, holding the hash of the crew token, and raises ShipClaimed', () => {
    const claim = aClaim();

    expect(claimShip({ ship: scout, heldLease: undefined }, claim)).toEqual(
      ok({
        lease: {
          id: claim.leaseId,
          fleetId,
          shipId: scout.id,
          location: { kind: 'CLOUD', description: null },
          crewTokenHash: 'sha256(aeolus_ct_v1_crew)',
          startedAt: claimedAt,
          endedAt: null,
        },
        events: [
          {
            fleetId,
            type: 'ShipClaimed',
            occurredAt: claimedAt,
            actor: { kind: 'ship', shipId: scout.id },
            shipId: scout.id,
            details: { leaseId: claim.leaseId, location: 'CLOUD', locationDescription: null },
          },
        ],
      }),
    );
  });

  it('carries the description of an OTHER location on ShipClaimed', () => {
    const claim = { ...aClaim(), location: { kind: 'OTHER' as const, description: 'a ci runner' } };

    expect(claimShip({ ship: scout, heldLease: undefined }, claim)).toMatchObject({
      isOk: true,
      value: { events: [{ details: { location: 'OTHER', locationDescription: 'a ci runner' } }] },
    });
  });

  it('refuses a second claim while a lease is held', () => {
    expect(claimShip({ ship: scout, heldLease: aLeaseOn(scout) }, aClaim())).toEqual({
      isOk: false,
      error: {
        kind: 'SHIP_NOT_AWAITING_CREW',
        message: 'scout is crewed: a session claims a ship only while it awaits crew',
      },
    });
  });

  it('refuses a retired ship', () => {
    const retired = { ...scout, retiredAt: createdAt };

    expect(claimShip({ ship: retired, heldLease: undefined }, aClaim())).toEqual({
      isOk: false,
      error: {
        kind: 'SHIP_NOT_AWAITING_CREW',
        message: 'scout is retired: a session claims a ship only while it awaits crew',
      },
    });
  });
});
