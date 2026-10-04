import { SCOPES, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, crewAboard, deliveryInFlight, initialiseFleet, OPERATOR, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { createCreateFleet } from './create-fleet.js';
import { createListInstallationFleets, type ListInstallationFleets } from './list-installation-fleets.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let core: InMemoryCore;
let listFleets: ListInstallationFleets;
let first: FleetId;
let hemma: FleetId;
let hemmaArgo: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T12:00:00.000Z');
  listFleets = createListInstallationFleets({ fleets: core.installationFleets, clock: core.clock });
  ({ fleetId: first } = await initialiseFleet(core));
  core.clock.advance(DAY_MS);
  ({ fleetId: hemma, operatorShipId: hemmaArgo } = unwrap(
    await createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids })({ requestId: 'signup-1', name: 'hemma', operatorEmail: 'lena@example.com' }),
  ));
});

/** A message stored in the fleet at the given time, with its delivery in flight with a crewed ship. */
function messageAt(fleetId: FleetId, at: Date): void {
  const ship = addAgentShip(core, { fleetId });
  const crew = crewAboard(core, { fleetId, shipId: ship.shipId });
  const now = core.clock.now();
  core.clock.set(at);
  deliveryInFlight(core, { fleetId, shipId: ship.shipId, leaseId: crew.leaseId });
  core.clock.set(now);
}

describe('listing the fleets of the installation', () => {
  it('describes every fleet, oldest first: its id, name, operator email and when it was created', async () => {
    await expect(listFleets()).resolves.toMatchObject([
      { fleetId: first, name: 'test fleet', operatorEmail: OPERATOR.email, createdAt: new Date('2026-10-01T12:00:00.000Z') },
      { fleetId: hemma, name: 'hemma', operatorEmail: 'lena@example.com', createdAt: new Date('2026-10-02T12:00:00.000Z') },
    ]);
  });

  it('counts the ships that are not retired, argo included', async () => {
    addAgentShip(core, { fleetId: hemma });
    addAgentShip(core, { fleetId: hemma, retiredAt: core.clock.now() });

    const listed = await listFleets();

    expect(listed.find((fleet) => fleet.fleetId === hemma)?.shipCount).toBe(2);
  });

  it('counts every message stored in the last 7 days, from 7 days ago on, and none older', async () => {
    const now = core.clock.now().getTime();
    messageAt(hemma, new Date(now - 7 * DAY_MS));
    messageAt(hemma, new Date(now - 60_000));
    messageAt(hemma, new Date(now - 7 * DAY_MS - 1));
    messageAt(first, new Date(now - 60_000));

    const listed = await listFleets();

    expect(listed.find((fleet) => fleet.fleetId === hemma)?.messagesLast7Days).toBe(2);
  });

  it("gives the time of the fleet's newest event as its last activity", async () => {
    core.clock.advance(DAY_MS);
    const argo: Caller = { fleetId: hemma, shipId: hemmaArgo, kind: 'operator', scopes: [...SCOPES] };
    unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    const listed = await listFleets();

    expect(listed.map((fleet) => fleet.lastActivityAt)).toEqual([new Date('2026-10-01T12:00:00.000Z'), new Date('2026-10-03T12:00:00.000Z')]);
  });
});
