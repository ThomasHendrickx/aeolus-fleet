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
import { newKey } from '../../../test/support/keys.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';

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
  scoutId = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).shipId;
  core.clock.advance(60_000);
});

describe('getting one ship', () => {
  it('gives the labels the ship carries', async () => {
    const { labelId, values } = unwrap(await useCases.defineLabel(argo, { key: 'os', values: ['macos'] }));
    const valueId = values[0]?.id ?? core.ids('labelValue');
    const { shipId: builderId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'implementer' }));
    unwrap(await useCases.assignLabel(argo, { shipId: builderId, valueId }));

    await expect(useCases.getShip(argo, { shipId: builderId })).resolves.toMatchObject({ isOk: true, value: { labels: [{ labelId, key: 'os', valueId, value: 'macos' }] } });
  });

  it('gives the ship as the fleet lists it, with when it was commissioned, not crewed and not retired', async () => {
    const ship = unwrap(await useCases.getShip(argo, { shipId: scoutId }));

    expect(ship).toEqual({
      ...(await useCases.listFleet(argo)).find((listed) => listed.id === scoutId),
      commissionedAt,
      crewedSince: null,
      retiredAt: null,
      inFlightDeliveries: 0,
      openDeliveries: 0,
      owner: { id: argo.shipId, name: 'argo' },
    });
  });

  it("gives its owner by id and name, a person's ship once argo set it (decision 0045)", async () => {
    const { shipId: thomasId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    unwrap(await useCases.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId }));

    await expect(useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({ isOk: true, value: { owner: { id: thomasId, name: 'thomas' } } });
  });

  it('gives argo no owner', async () => {
    await expect(useCases.getShip(argo, { shipId: argo.shipId })).resolves.toMatchObject({ isOk: true, value: { owner: null } });
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

describe('getting one ship within read reach (decision 0034)', () => {
  let fleet: ReadReachScenario;

  beforeEach(async () => {
    fleet = await readReachScenario();
    await fleet.readRulesApply();
  });

  it('gives a ship outside read reach by its name, type and status only', async () => {
    const { status } = unwrap(await fleet.registry.getShip(fleet.argo, { shipId: fleet.far.shipId }));

    expect(unwrap(await fleet.registry.getShip(fleet.reader, { shipId: fleet.far.shipId }))).toEqual({ id: fleet.far.shipId, name: 'far', type: 'keeper', status, isInReadReach: false });
  });

  it('gives a ship within read reach whole', async () => {
    expect(unwrap(await fleet.registry.getShip(fleet.reader, { shipId: fleet.near.shipId }))).toEqual(unwrap(await fleet.registry.getShip(fleet.argo, { shipId: fleet.near.shipId })));
  });
});
