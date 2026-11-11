import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { aMatchedFleet, expectRuleMatchesKept, storedRuleMatchesOf } from './support/rule-match-postgres.js';

// Q4 of rule-matches.md: after every writer commits, the stored rule matches
// equal a fresh computation from the authoritative tables.

let core: PostgresCore;
beforeAll(async () => {
  core = await createPostgresCore();
});
afterAll(async () => {
  await core.close();
});

describe('rule matches kept by every writer', () => {
  it('stay a fresh computation after commissioning a ship with label values and a person ship', async () => {
    // Given a fleet whose rules hold for carried values and owners.
    const fleet = await aMatchedFleet(core);

    // When the declarer commissions a ship carrying its value, and a person ship is commissioned, owning itself.
    unwrap(await core.useCases.commissionShip(fleet.declarer, { idempotencyKey: newKey(), name: 'commissioned', type: 'builder', valueIds: [fleet.red, fleet.blue] }));
    await expectRuleMatchesKept(core, fleet.fleetId);
    await fleet.commission({ name: 'second-person', kind: 'person' });

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(core, fleet.fleetId);
    expect((await storedRuleMatchesOf(core, fleet.fleetId)).length).toBeGreaterThan(0);
  });

  it('stay a fresh computation after assigning and unassigning a label value', async () => {
    // Given a fleet with matches.
    const fleet = await aMatchedFleet(core);

    // When a value is assigned, then another taken off.
    unwrap(await core.useCases.assignLabel(fleet.argo, { shipId: fleet.second, valueId: fleet.gold }));
    await expectRuleMatchesKept(core, fleet.fleetId);
    unwrap(await core.useCases.unassignLabel(fleet.argo, { shipId: fleet.first, valueId: fleet.red }));

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(core, fleet.fleetId);
  });

  it('stay a fresh computation after setting an owner', async () => {
    // Given a fleet with matches.
    const fleet = await aMatchedFleet(core);

    // When a ship gets another owner.
    unwrap(await core.useCases.setOwner(fleet.argo, { shipId: fleet.first, ownerShipId: fleet.person.shipId }));

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(core, fleet.fleetId);
  });

  it('stay a fresh computation after a ship and the installation declare and withdraw rules', async () => {
    // Given a fleet with matches.
    const fleet = await aMatchedFleet(core);

    // When the ship replaces its declaration, the installation its own, then the ship withdraws.
    unwrap(await core.useCases.declareNetworkRules(fleet.declarer, { rules: [{ verb: 'read', from: [], to: [fleet.blue] }, { verb: 'send', from: [], to: [] }] }));
    await expectRuleMatchesKept(core, fleet.fleetId);
    unwrap(await core.useCases.declareNetworkRules(fleet.installation, { rules: [{ verb: 'send', from: [], to: [fleet.silver] }] }));
    await expectRuleMatchesKept(core, fleet.fleetId);
    unwrap(await core.useCases.declareNetworkRules(fleet.declarer, { rules: [] }));

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(core, fleet.fleetId);
  });

  it('stay a fresh computation after applying other own rules, then none', async () => {
    // Given a fleet with matches.
    const fleet = await aMatchedFleet(core);

    // When the fleet applies other rules of its own, then none (open).
    await fleet.setRules([{ verb: 'read', from: [], to: [fleet.silver] }, ...fleet.ownRules.slice(1)]);
    await expectRuleMatchesKept(core, fleet.fleetId);
    await fleet.setRules(null);

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(core, fleet.fleetId);
  });

  it('stay a fresh computation after retiring a carrier, a person ship owning a ship, and a declarer whose labels others carry', async () => {
    // Given a fleet with matches, the person ship owning a carrier.
    const fleet = await aMatchedFleet(core);
    const owned = await fleet.ship('owned', { valueIds: [fleet.blue], owner: fleet.person.shipId });

    // When a carrier retires, then the person ship, so its ship falls to argo, then the declarer.
    unwrap(await core.useCases.retireShip(fleet.argo, { shipId: fleet.first }));
    await expectRuleMatchesKept(core, fleet.fleetId);
    unwrap(await core.useCases.retireShip(fleet.argo, { shipId: fleet.person.shipId }));
    await expectRuleMatchesKept(core, fleet.fleetId);
    expect(await core.prisma.ship.findUniqueOrThrow({ where: { id: owned }, select: { ownerShipId: true } })).toEqual({ ownerShipId: fleet.argo.shipId });
    unwrap(await core.useCases.retireShip(fleet.argo, { shipId: fleet.declarerShipId }));

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(core, fleet.fleetId);
  });

  it('stay a fresh computation when a change of carried label values is refused', async () => {
    // Given a fleet whose ships carry both team values.
    const fleet = await aMatchedFleet(core);

    // When the declarer tries to drop a carried value.
    const refused = await core.useCases.changeLabelValues(fleet.declarer, { labelId: fleet.teamId, values: ['red'] });

    // Then nothing changed, the matches included.
    expect(refused.isOk).toBe(false);
    await expectRuleMatchesKept(core, fleet.fleetId);
  });

  it('go with the fleet when it is deleted', async () => {
    // Given a fleet with matches.
    const fleet = await aMatchedFleet(core);
    expect((await storedRuleMatchesOf(core, fleet.fleetId)).length).toBeGreaterThan(0);

    // When the fleet is deleted.
    unwrap(await core.useCases.deleteFleet({ requestId: newKey(), fleetId: fleet.fleetId }));

    // Then none of its matches remain.
    expect(await storedRuleMatchesOf(core, fleet.fleetId)).toEqual([]);
  });
});
