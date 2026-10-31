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
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { newKey } from '../../testing/keys.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { createCloseHealthSnapshots } from '../shared/close-health-snapshots.js';
import { createPruneHistory } from '../shared/prune-history.js';

const commissionedAt = new Date('2026-09-29T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

let core: InMemoryCore;
let useCases: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
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
  it("gives the ship that commissioned it, so the console names the gateway's proxy ship as a reader (decision 0068, B19); none for argo", async () => {
    const scout = unwrap(await useCases.getShip(argo, { shipId: scoutId }));
    const operator = unwrap(await useCases.getShip(argo, { shipId: argo.shipId }));

    expect(['commissionedByShipId' in scout && scout.commissionedByShipId, 'commissionedByShipId' in operator && operator.commissionedByShipId]).toEqual([argo.shipId, null]);
  });

  it('gives the labels the ship carries', async () => {
    const { labelId, values } = unwrap(await useCases.defineLabel(argo, { key: 'os', values: ['macos'] }));
    const valueId = values[0]?.id ?? core.ids('labelValue');
    const { shipId: builderId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'implementer' }));
    unwrap(await useCases.assignLabel(argo, { shipId: builderId, valueId }));

    await expect(useCases.getShip(argo, { shipId: builderId })).resolves.toMatchObject({ isOk: true, value: { labels: [{ labelId, key: 'os', valueId, value: 'macos' }] } });
  });

  it('gives the ship as the fleet lists it, with when it was commissioned, not crewed, not retired and not removed', async () => {
    const ship = unwrap(await useCases.getShip(argo, { shipId: scoutId }));

    expect(ship).toEqual({
      ...(await useCases.listFleet(argo)).ships.find((listed) => listed.id === scoutId),
      commissionedAt,
      crewedSince: null,
      retiredAt: null,
      removedAt: null,
      inFlightDeliveries: 0,
      openDeliveries: 0,
      owner: { id: argo.shipId, name: 'argo' },
      commissionedByShipId: argo.shipId,
      statement: null,
      openAlerts: [],
      expectations: { reportChangesWithin: null, taskDoneBy: null },
    });
  });

  it("gives its crew's statement while one is stated (decision 0047)", async () => {
    const scout = crewAboard(core, { fleetId, shipId: scoutId });
    unwrap(await useCases.setStatement(scout, { summary: 'Reviews pull requests.', capabilities: [{ name: 'review_pr' }] }));

    await expect(useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({
      value: { statement: { by: 'crew', version: 1, summary: 'Reviews pull requests.', capabilities: [{ name: 'review_pr' }] } },
    });
  });

  it('gives its commission note while no crew stated a statement', async () => {
    const { shipId: vaultId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'vault', type: 'keeper', note: 'Keeps the release keys' }));

    await expect(useCases.getShip(argo, { shipId: vaultId })).resolves.toMatchObject({
      value: { statement: { by: 'commission', note: 'Keeps the release keys' } },
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

/** The pruning pass removes the retired ship: the fleet keeps its history 30 days, and 31 pass. */
async function removedByThePass(on: InMemoryCore, inFleet: FleetId): Promise<void> {
  on.state.fleetLimitSettings.push({
    fleetId: inFleet,
    ships: { kind: 'default' },
    dailyMessages: { kind: 'default' },
    schedulesPerShip: { kind: 'default' },
    minimumScheduleInterval: { kind: 'default' },
    retention: { kind: 'fleet', days: 30 },
  });
  on.clock.advance(31 * DAY_MS);
  await createCloseHealthSnapshots({ fleets: on.fleets, uow: on.uow, clock: on.clock })();
  await createPruneHistory({ fleets: on.fleets, uow: on.uow, clock: on.clock, ids: on.ids })();
}

describe('getting a removed ship (decision 0070, D8)', () => {
  it('scenario 18: a removed ship within read reach answers its id, name, type, kind, status retired, its three dates, no scopes, and no owner, statement, labels or crew', async () => {
    // Given
    const { values } = unwrap(await useCases.defineLabel(argo, { key: 'os', values: ['macos'] }));
    unwrap(await useCases.assignLabel(argo, { shipId: scoutId, valueId: values[0]?.id ?? core.ids('labelValue') }));
    const retiredAt = core.clock.now();
    unwrap(await useCases.retireShip(argo, { shipId: scoutId }));
    await removedByThePass(core, fleetId);

    // When
    const ship = unwrap(await useCases.getShip(argo, { shipId: scoutId }));

    // Then
    expect(ship).toMatchObject({
      id: scoutId,
      name: 'scout',
      type: 'reviewer',
      kind: 'agent',
      status: 'retired',
      commissionedAt,
      retiredAt,
      removedAt: core.clock.now(),
      scopes: [],
      owner: null,
      statement: null,
      labels: [],
      crewedSince: null,
      report: null,
      crewRequest: null,
    });
  });

  it('scenario 20: a removed ship outside the reader\'s read reach answers as today, its name, type and status only', async () => {
    // Given
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.far.shipId }));
    await removedByThePass(fleet.core, fleet.fleetId);

    // When
    const ship = unwrap(await fleet.registry.getShip(fleet.reader, { shipId: fleet.far.shipId }));

    // Then
    expect(fleet.core.state.ships.find((held) => held.id === fleet.far.shipId)?.removedAt).not.toBeNull();
    expect(ship).toEqual({ id: fleet.far.shipId, name: 'far', type: 'keeper', status: 'retired', isInReadReach: false });
  });
});
