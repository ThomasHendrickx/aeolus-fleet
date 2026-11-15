import { createIdGenerator, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addAgentShip, crewAboard, deliveryInFlight, identityUseCases, initialiseFleet, OPERATOR } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore, type InMemoryState } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { createCreateFleet } from './create-fleet.js';
import { createDeleteFleet, type DeleteFleet } from './delete-fleet.js';
import { createRemoveDeletedFleets, type RemoveDeletedFleets } from './remove-deleted-fleets.js';

const newId = createIdGenerator();
let core: InMemoryCore;
let deleteFleet: DeleteFleet;
let removeDeletedFleets: RemoveDeletedFleets;
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
    meetings: of(state.meetings),
    schedules: of(state.schedules),
    scheduleNotices: of(state.scheduleNotices),
    leaseSeen: of(state.leaseSeen),
    pushedLeases: of(state.pushedLeases),
    leaseReports: of(state.leaseReports),
    leaseStatements: of(state.leaseStatements),
    leaseTurns: of(state.leaseTurns),
    leaseActivities: of(state.leaseActivities),
    crewRequests: of(state.crewRequests),
    clearRequests: of(state.clearRequests),
    labels: of(state.labels),
    shipLabels: of(state.shipLabels),
    networkSettings: of(state.networkSettings),
    declaredNetworkRules: of(state.declaredNetworkRules),
    networkRulesDrafts: of(state.networkRulesDrafts),
    scopeNamespaces: of(state.scopeNamespaces),
    commissionApprovals: 0,
    definedScopes: of(state.definedScopes),
    verifiedFacts: of(state.verifiedFacts),
    alerts: of(state.alerts),
    expectations: of(state.expectations),
    reachRefusals: of(state.reachRefusals),
    deliveryReads: of(state.deliveryReads),
    events: of(state.events),
    overdueDeliveries: of(state.overdueDeliveries),
    notices: of(state.notices),
    noticeDismissals: of(state.noticeDismissals),
    guideProgress: of(state.guideProgress),
    fleetLimitSettings: of(state.fleetLimitSettings),
    healthSnapshots: of(state.healthSnapshots),
    // Another instance's snapshot lock, as a test holds it: no row.
    healthSnapshotLocks: 0,
    // The pruning columns on the fleets row, apart from the Fleet.
    fleetPrunes: of(state.fleetPrunes),
    deletedFleets: of(state.deletedFleets),
    prunedExchanges: of(state.prunedExchanges),
    // Another server's prune lock and another transaction's row locks, as a test holds them: no row.
    historyPruneLocks: 0,
    lockedMessages: 0,
    // The places of pruned events in the fleet's stream: the seq column of the events left, no row.
    prunedEventSeqs: 0,
    fleetSealings: of(state.fleetSealings),
    dataKeys: of(state.dataKeys),
    sealingLocks: 0,
    featureFlags: of(state.featureFlags),
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
  removeDeletedFleets = createRemoveDeletedFleets({ fleets: core.fleets, uow: core.uow, clock: core.clock });
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
    await removeDeletedFleets();

    expect(Object.values(rowsOf(doomed)).every((count) => count === 0)).toBe(true);
  });

  it('reads the fleet as gone at once, before the removal pass: no fleet, no sign-in, no secret, no crew request, no key to open what it sealed, and the fleet does not count', async () => {
    const trierarch = addAgentShip(core, { fleetId: doomed, name: 'mac-studio' });
    const cook = addAgentShip(core, { fleetId: doomed, name: 'cook' });
    core.state.crewRequests.push({
      fleetId: doomed,
      shipId: cook.shipId,
      settings: {},
      settingsVersion: 1,
      requestedAt: core.clock.now(),
      requestedBy: null,
      assignedTo: null,
      status: null,
      reason: null,
      attempt: 0,
      sessionStartedAt: null,
      isFinal: false,
      givenBack: [{ trierarchShipId: trierarch.shipId, settingsVersion: 1, reason: 'no room', givenBackAt: core.clock.now() }],
    });
    core.state.dataKeys.push({ id: newId('dataKey'), fleetId: doomed, wrappedByCompanyKey: new Uint8Array(32).fill(7), wrappedByRecoveryKey: new Uint8Array(32).fill(9), checkValue: new Uint8Array(8).fill(3), createdAt: core.clock.now(), isCurrent: true });

    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));

    expect(await core.fleets.find(doomed)).toBeUndefined();
    expect((await core.fleets.list()).map((fleet) => fleet.id)).toEqual([kept]);
    expect(await core.fleets.count()).toBe(1);
    const rows = rowsOf(doomed);
    expect([rows.credentials, rows.operatorAccounts, rows.consoleSessions, rows.signInTickets, rows.crewRequests]).toEqual([0, 0, 0, 0, 0]);
    // Its data keys are shredded: no wrap of the key and no check value left, so no sealed payload opens; the rows go in the batches after what they sealed.
    expect(core.state.dataKeys.filter((key) => key.fleetId === doomed).map(({ wrappedByCompanyKey, wrappedByRecoveryKey, checkValue }) => [wrappedByCompanyKey.length, wrappedByRecoveryKey, checkValue.length])).toEqual([[0, null, 0]]);
    await expect(deleteFleet({ requestId: 'delete-2', fleetId: doomed })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_NOT_FOUND' } });
  });

  it('removes the history in batches of the size it is given', async () => {
    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));
    const batches: number[] = [];
    const counting = createRemoveDeletedFleets({
      fleets: core.fleets,
      uow: { run: (work) => core.uow.run(async (tx) => work({ fleetRemoval: { ...tx.fleetRemoval, removeHistoryBatch: async (...args) => { batches.push(rowsOf(doomed).messages + rowsOf(doomed).deliveries + rowsOf(doomed).events); return tx.fleetRemoval.removeHistoryBatch(...args); } } })) },
      clock: core.clock,
      batch: 1,
    });

    await counting();

    expect(batches.length).toBeGreaterThan(1);
    expect(Object.values(rowsOf(doomed)).every((count) => count === 0)).toBe(true);
  });

  it('leaves every other fleet as it was', async () => {
    const before = rowsOf(kept);

    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));
    await removeDeletedFleets();

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
    await removeDeletedFleets();

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
    await removeDeletedFleets();

    expect(core.state.installationRequests.map((request) => Object.keys(request).sort())).toEqual([['at', 'kind', 'requestHash', 'requestId']]);
    expect(JSON.stringify(core.state.installationRequests)).not.toMatch(/hemma|lena@example\.com/);
  });

  it('refuses another fleet, or the request id of a create whose fleet is still there', async () => {
    unwrap(await createCreateFleet({ uow: core.uow, clock: core.clock, ids: core.ids, hasher: core.hasher })({ requestId: 'signup-2', name: 'other', operatorEmail: 'olle@example.com' }));
    unwrap(await deleteFleet({ requestId: 'delete-1', fleetId: doomed }));
    await removeDeletedFleets();

    await expect(deleteFleet({ requestId: 'delete-1', fleetId: kept })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
    await expect(deleteFleet({ requestId: 'signup-2', fleetId: kept })).resolves.toMatchObject({ isOk: false, error: { kind: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(core.state.fleets).toHaveLength(2);
  });
});
