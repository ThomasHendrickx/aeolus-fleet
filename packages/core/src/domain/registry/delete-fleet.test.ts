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
 * so a new table must say here how it belongs to a fleet; of the installation's
 * requests, a create names the fleet it created.
 */
function rowsOf(fleetId: FleetId): Record<keyof InMemoryState, number> {
  const { state } = core;
  const of = (rows: readonly { fleetId: FleetId }[]) => rows.filter((row) => row.fleetId === fleetId).length;
  return {
    fleets: state.fleets.filter((fleet) => fleet.id === fleetId).length,
    ships: of(state.ships),
    leases: of(state.leases),
    credentials: of(state.credentials),
    operatorAccounts: of(state.operatorAccounts),
    consoleSessions: of(state.consoleSessions),
    signInTickets: of(state.signInTickets),
    messages: of(state.messages),
    deliveries: of(state.deliveries),
    leaseSeen: of(state.leaseSeen),
    leaseReports: of(state.leaseReports),
    crewRequests: of(state.crewRequests),
    clearRequests: of(state.clearRequests),
    labels: of(state.labels),
    shipLabels: of(state.shipLabels),
    networkSettings: of(state.networkSettings),
    deliveryReads: of(state.deliveryReads),
    events: of(state.events),
    notices: of(state.notices),
    noticeDismissals: of(state.noticeDismissals),
    guideProgress: of(state.guideProgress),
    fleetLimitSettings: of(state.fleetLimitSettings),
    // The installation's settings belong to no fleet.
    installationSettings: 0,
    // Neither do its console notices (decision 0023).
    installationNotices: 0,
    // Nor its guide (decision 0024).
    installationGuide: 0,
    installationRequests: state.installationRequests.filter((request) => request.kind === 'createFleet' && request.fleetId === fleetId).length,
  };
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-04T12:00:00.000Z');
  deleteFleet = createDeleteFleet({ uow: core.uow, clock: core.clock, hasher: core.hasher });
  ({ fleetId: kept } = await initialiseFleet(core));
  ({ fleetId: doomed } = unwrap(
    await createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher })({ requestId: 'signup-1', name: 'hemma', operatorEmail: 'lena@example.com' }),
  ));
  // A busy fleet to delete: a crewed ship and a message in flight with it. The kept
  // fleet's operator is signed in, so its console session and argo's lease must stay.
  const scout = addAgentShip(core, { fleetId: doomed, name: 'scout' });
  const crew = crewAboard(core, { fleetId: doomed, shipId: scout.shipId });
  deliveryInFlight(core, { fleetId: doomed, shipId: scout.shipId, leaseId: crew.leaseId });
  unwrap(await identityUseCases(core).signIn(OPERATOR));
});

describe('deleting a fleet for the installation', () => {
  it('deletes the fleet and every record in it: ships, leases, secrets, messages, deliveries, events, its operator, the request that created it', async () => {
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
      value: { isReplay: false, fleetId: doomed, name: 'hemma', operatorEmail: 'lena@example.com' },
    });
  });

  it('refuses a fleet the installation does not host', async () => {
    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));

    await expect(deleteFleet({ requestId: 'delete-2', fleetId: doomed })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_NOT_FOUND' } });
  });
});

describe('a delete that comes again under its request id', () => {
  it('answers that the fleet was deleted, though it is gone, as a replay the server does not log again', async () => {
    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));

    await expect(deleteFleet({ requestId: 'delete-1', fleetId: doomed })).resolves.toEqual({ isOk: true, value: { isReplay: true, fleetId: doomed } });
  });

  it("keeps nothing of the fleet in the record of the delete: no fleet id, name or operator email, only the request's hash", async () => {
    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));

    expect(core.state.installationRequests.map((request) => Object.keys(request).sort())).toEqual([['at', 'kind', 'requestHash', 'requestId']]);
    expect(JSON.stringify(core.state.installationRequests)).not.toMatch(/hemma|lena@example\.com/);
  });

  it('refuses another fleet, or the request id of a create whose fleet is still there', async () => {
    unwrap(await createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher })({ requestId: 'signup-2', name: 'other', operatorEmail: 'olle@example.com' }));
    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));

    await expect(deleteFleet({ requestId: 'delete-1', fleetId: kept })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
    await expect(deleteFleet({ requestId: 'signup-2', fleetId: kept })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(core.state.fleets).toHaveLength(2);
  });
});
