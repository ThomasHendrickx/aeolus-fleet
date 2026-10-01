import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewAboard,
  crewShip,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

const commissionedAt = new Date('2026-09-29T12:00:00.000Z');

let core: InMemoryCore;
let useCases: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore(commissionedAt.toISOString());
  const fleet = await initialiseFleet(core);
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  useCases = registryUseCases(core);
  scoutId = unwrap(await useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' })).shipId;
  core.clock.advance(60_000);
});

describe('getting one ship', () => {
  it('gives the ship as the fleet lists it, with when it was commissioned, not crewed and not retired', async () => {
    const ship = unwrap(await useCases.getShip(argo, { shipId: scoutId }));

    expect(ship).toEqual({
      ...(await useCases.listFleet(argo)).find((listed) => listed.id === scoutId),
      commissionedAt,
      crewedSince: null,
      retiredAt: null,
      inFlightDeliveries: 0,
      openDeliveries: 0,
    });
  });

  it('gives since when the session crewing it has held it', async () => {
    const crewedAt = core.clock.now();
    crewShip(core, { fleetId, shipId: scoutId });
    core.clock.advance(60_000);

    await expect(useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({
      value: { status: 'crewed', crewedSince: crewedAt },
    });
  });

  it('gives when a retired ship retired', async () => {
    const retiredAt = core.clock.now();
    const scout = core.state.ships.find((ship) => ship.id === scoutId);
    if (scout) {
      scout.retiredAt = retiredAt;
    }

    await expect(useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({
      value: { status: 'retired', retiredAt },
    });
  });

  it('counts what its crew holds in flight, and its direct deliveries open, which a retire would abandon', async () => {
    const messaging = messagingUseCases(core);
    const scout = crewAboard(core, { fleetId, shipId: scoutId });
    const send = (selector: { kind: 'ship'; shipId: ShipId } | { kind: 'type'; type: string }, key: string) =>
      messaging.sendMessage(argo, { selector, payload: 'Review', idempotencyKey: key });
    unwrap(await send({ kind: 'ship', shipId: scoutId }, 'direct-1'));
    unwrap(await send({ kind: 'type', type: 'reviewer' }, 'type-1'));
    unwrap(await messaging.receiveDeliveries(scout, { max: 2 }));
    unwrap(await send({ kind: 'ship', shipId: scoutId }, 'direct-2'));

    await expect(useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({
      value: { inFlightDeliveries: 2, openDeliveries: 2 },
    });
  });

  it('knows no ship of another fleet', async () => {
    const elsewhere = { ...argo, fleetId: core.ids('fleet') };

    await expect(useCases.getShip(elsewhere, { shipId: scoutId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });

  it('knows no unknown ship', async () => {
    await expect(useCases.getShip(argo, { shipId: core.ids('ship') })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });
});
