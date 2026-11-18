import { describe, expect, it } from 'vitest';

import { addViewerShip, applyNetworkRules, crewAboard, everyShipMay, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { createLookup } from './lookup.js';

async function aFleet() {
  const core = createInMemoryCore();
  const fleet = await initialiseFleet(core);
  const registry = registryUseCases(core);
  const argo = operatorCaller(fleet);
  const commission = async (name: string) => unwrap(await registry.commissionShip(argo, { name, type: 'agent', note: 'Commission note.', idempotencyKey: newKey() })).shipId;
  const caller = crewAboard(core, { fleetId: fleet.fleetId, shipId: await commission('caller') });
  const targetId = await commission('target');
  const target = crewAboard(core, { fleetId: fleet.fleetId, shipId: targetId });
  return { core, fleet, registry, argo, caller, target, targetId, lookup: createLookup({ uow: core.uow }) };
}

describe('one reachable ship (#1911)', () => {
  it('answers one name or id with only its header and records nothing', async () => {
    const { core, registry, caller, target, targetId, lookup } = await aFleet();
    unwrap(await registry.setStatement(target, { summary: '  Reviews ships! More detail.', capabilities: [] }));
    const eventsBefore = [...core.state.events];

    const byName = unwrap(await lookup(caller, { name: 'target' }));
    const byId = unwrap(await lookup(caller, { id: targetId }));

    expect(byName).toEqual({ id: targetId, name: 'target', description: 'Reviews ships!' });
    expect(byId).toEqual(byName);
    expect(core.state.events).toEqual(eventsBefore);
    expect(core.state.reachRefusals).toEqual([]);
  });

  it.each([
    ['Dr. Smith works.', 'Dr.'], ['Hello?\nNext.', 'Hello?'], ['  No punctuation  ', 'No punctuation'],
    ['One\nline. Next', 'One\nline.'], ['雪! More', '雪!'], ['  ', null],
  ])('uses the approved literal first sentence of %j', async (summary, description) => {
    const { registry, caller, target, targetId, lookup } = await aFleet();
    unwrap(await registry.setStatement(target, { summary, capabilities: [] }));

    const answer = unwrap(await lookup(caller, { id: targetId }));

    expect(answer).toEqual({ id: targetId, name: 'target', description });
  });

  it('answers null description without a crew statement despite a commission note', async () => {
    const { caller, targetId, lookup } = await aFleet();

    const answer = unwrap(await lookup(caller, { id: targetId }));

    expect(answer).toEqual({ id: targetId, name: 'target', description: null });
  });

  it('answers null for missing, self, viewer, retired, cross-fleet and currently unreachable targets', async () => {
    const { core, fleet, registry, argo, caller, targetId, lookup } = await aFleet();
    addViewerShip(core, { fleetId: fleet.fleetId });
    await applyNetworkRules(registry, { by: argo, rules: [everyShipMay('read'), everyShipMay('manage')] });
    const other = await aFleet();

    expect(unwrap(await lookup(caller, { name: 'missing' }))).toBeNull();
    expect(unwrap(await lookup(caller, { id: caller.shipId }))).toBeNull();
    expect(unwrap(await lookup(caller, { name: 'viewer' }))).toBeNull();
    expect(unwrap(await lookup(caller, { id: other.targetId }))).toBeNull();
    expect(unwrap(await lookup(caller, { id: targetId }))).toBeNull();
    await applyNetworkRules(registry, { by: argo, rules: null });
    expect(unwrap(await lookup(caller, { id: targetId }))).not.toBeNull();
    unwrap(await registry.retireShip(argo, { shipId: targetId }));
    expect(unwrap(await lookup(caller, { id: targetId }))).toBeNull();
    expect(core.state.reachRefusals).toEqual([]);
  });
});
