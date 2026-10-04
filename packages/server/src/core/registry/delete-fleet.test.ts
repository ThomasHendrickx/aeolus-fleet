import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, crewAboard, deliveryInFlight, identityUseCases, initialiseFleet, OPERATOR } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore, type InMemoryState } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import { createCreateFleet } from './create-fleet.js';
import { createDeleteFleet, type DeleteFleet } from './delete-fleet.js';

let core: InMemoryCore;
let deleteFleet: DeleteFleet;
let kept: FleetId;
let doomed: FleetId;

/**
 * How many rows of each table belong to the fleet. Typed over the whole state,
 * so a new table must say here how it belongs to a fleet; the installation's
 * requests belong to none.
 */
function rowsOf(fleetId: FleetId): Record<Exclude<keyof InMemoryState, 'installationRequests'>, number> {
  const { state } = core;
  const of = (rows: readonly { fleetId: FleetId }[]) => rows.filter((row) => row.fleetId === fleetId).length;
  return {
    fleets: state.fleets.filter((fleet) => fleet.id === fleetId).length,
    ships: of(state.ships),
    leases: of(state.leases),
    credentials: of(state.credentials),
    operatorAccounts: of(state.operatorAccounts),
    consoleSessions: of(state.consoleSessions),
    messages: of(state.messages),
    deliveries: of(state.deliveries),
    leaseSeen: of(state.leaseSeen),
    leaseReports: of(state.leaseReports),
    deliveryReads: of(state.deliveryReads),
    events: of(state.events),
    notices: of(state.notices),
  };
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  deleteFleet = createDeleteFleet({ uow: core.uow, clock: core.clock });
  ({ fleetId: kept } = await initialiseFleet(core));
  ({ fleetId: doomed } = unwrap(
    await createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids })({ requestId: 'signup-1', name: 'hemma', operatorEmail: 'lena@example.com' }),
  ));
  // A busy fleet to delete: a crewed ship and a message in flight with it. The kept
  // fleet's operator is signed in, so its console session and argo's lease must stay.
  const scout = addAgentShip(core, { fleetId: doomed, name: 'scout' });
  const crew = crewAboard(core, { fleetId: doomed, shipId: scout.shipId });
  deliveryInFlight(core, { fleetId: doomed, shipId: scout.shipId, leaseId: crew.leaseId });
  unwrap(await identityUseCases(core).signIn(OPERATOR));
});

describe('deleting a fleet for the installation', () => {
  it('deletes the fleet and every record in it: ships, leases, secrets, messages, deliveries, events, its operator', async () => {
    expect(Object.values(rowsOf(doomed)).some((count) => count > 0)).toBe(true);

    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));

    expect(Object.values(rowsOf(doomed)).every((count) => count === 0)).toBe(true);
  });

  it('leaves every other fleet as it was', async () => {
    const before = rowsOf(kept);

    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));

    expect(rowsOf(kept)).toEqual(before);
  });

  it("answers the fleet's name and operator email, for the server's log", async () => {
    await expect(deleteFleet({ requestId: 'delete-1', fleetId: doomed })).resolves.toEqual({
      isOk: true,
      value: { fleetId: doomed, name: 'hemma', operatorEmail: 'lena@example.com' },
    });
  });

  it('refuses a fleet the installation does not host', async () => {
    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));

    await expect(deleteFleet({ requestId: 'delete-2', fleetId: doomed })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_NOT_FOUND' } });
  });
});

describe('a delete that comes again under its request id', () => {
  it('answers what the first one answered, though the fleet is gone', async () => {
    const first = unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));

    await expect(deleteFleet({ requestId: 'delete-1', fleetId: doomed })).resolves.toEqual({ isOk: true, value: first });
  });

  it('refuses another fleet, or a request id a create used', async () => {
    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));

    await expect(deleteFleet({ requestId: 'delete-1', fleetId: kept })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
    await expect(deleteFleet({ requestId: 'signup-1', fleetId: kept })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(core.state.fleets.map((fleet) => fleet.id)).toEqual([kept]);
  });
});
