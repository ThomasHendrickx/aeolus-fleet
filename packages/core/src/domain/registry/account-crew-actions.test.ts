import { accountIdSchema, type LabelValueId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, everyShipMay } from '../../../test/support/core-fixtures.js';
import { aCrewSettings, shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { AccountCaller, ShipCaller } from '../shared/caller.js';

/**
 * The console's crew actions for an account signed in as itself (accounts
 * design, F1, F3): asking for crew, removing the request, a new crew, and
 * assigning or explaining a request, each with the account as its actor.
 * Those on a ship are kept to its manage reach. near carries group a, far
 * group b; the rules let group a manage group a.
 */
let fleet: ReadReachScenario;
let mathilde: AccountCaller;
let trierarch: ShipCaller;

const MATHILDE = accountIdSchema.parse('acc-mathilde');
const ACTOR = { kind: 'account', accountId: MATHILDE, throughShipId: null };
const NOT_REACHABLE = { isOk: false, error: { kind: 'NOT_REACHABLE' } };

function group(value: 'a' | 'b'): LabelValueId {
  return valueIdOf(fleet.core, { key: 'group', value });
}

function actorsOf(type: string) {
  return fleet.core.state.events.filter((event) => event.type === type).map(({ actor }) => actor);
}

/** A ship argo commissions, awaiting crew, with a crew request for the harness. */
async function awaitingCrew(name: string, harness: string): Promise<ShipId> {
  const { shipId } = unwrap(await fleet.registry.commissionShip(fleet.argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  unwrap(await fleet.registry.requestCrew(fleet.argo, { shipId, settings: aCrewSettings({ harness }) }));
  return shipId;
}

beforeEach(async () => {
  fleet = await readReachScenario();
  unwrap(await fleet.registry.defineLabel(fleet.argo, { key: 'group', values: ['a', 'b'] }));
  unwrap(await fleet.registry.assignLabel(fleet.argo, { shipId: fleet.near.shipId, valueId: group('a') }));
  unwrap(await fleet.registry.assignLabel(fleet.argo, { shipId: fleet.far.shipId, valueId: group('b') }));
  await applyNetworkRules(fleet.registry, { by: fleet.networking, rules: [{ verb: 'manage', from: [group('a')], to: [group('a')] }, everyShipMay('send')] });
  trierarch = await shipWithScopes({ registry: fleet.registry, argo: fleet.argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });
  mathilde = { kind: 'account', accountId: MATHILDE, fleetId: fleet.fleetId, scopes: ['fleet:read', 'fleet:manage', 'crew:assign'], groupValues: ['a'], personShipId: null, throughShipId: null };
  fleet.core.state.events.length = 0;
});

describe("an account and a ship's crew request", () => {
  it('asks for crew for a ship in its reach and removes the request, the events naming the account', async () => {
    unwrap(await fleet.registry.requestCrew(mathilde, { shipId: fleet.near.shipId, settings: aCrewSettings({ harness: 'claude-code' }) }));
    unwrap(await fleet.registry.removeCrewRequest(mathilde, { shipId: fleet.near.shipId }));

    expect([...actorsOf('CrewRequested'), ...actorsOf('CrewRequestRemoved')]).toEqual([ACTOR, ACTOR]);
  });

  it('is refused asking for crew for a ship out of its reach, which holds no request', async () => {
    await expect(fleet.registry.requestCrew(mathilde, { shipId: fleet.far.shipId, settings: aCrewSettings({ harness: 'claude-code' }) })).resolves.toMatchObject(NOT_REACHABLE);
    expect(fleet.core.state.crewRequests.filter(({ shipId }) => shipId === fleet.far.shipId)).toEqual([]);
  });

  it('assigns a request to a trierarch and explains one, the events naming the account', async () => {
    const scout = await awaitingCrew('scout', 'claude-code');
    const keeper = await awaitingCrew('keeper', 'codex');
    fleet.core.state.events.length = 0;

    unwrap(await fleet.registry.assignCrew(mathilde, { shipId: scout, trierarchShipId: trierarch.shipId }));
    unwrap(await fleet.registry.explainCrewRequest(mathilde, { shipId: keeper, reason: 'No trierarch runs codex' }));

    expect(fleet.core.state.events.map(({ type, actor }) => ({ type, actor }))).toEqual([
      { type: 'CrewAssigned', actor: ACTOR },
      { type: 'CrewRequestExplained', actor: ACTOR },
    ]);
  });
});

describe('an account giving a ship a new crew', () => {
  it('recrews a ship in its reach: the crew is released and a starting prompt issued, the events naming the account', async () => {
    const issued = unwrap(await fleet.registry.recrewShip(mathilde, { shipId: fleet.near.shipId }));

    expect(issued.shipId).toBe(fleet.near.shipId);
    expect(new Set(fleet.core.state.events.map(({ actor }) => actor))).toEqual(new Set([ACTOR]));
  });

  it('is refused a ship out of its reach, which keeps its crew', async () => {
    await expect(fleet.registry.recrewShip(mathilde, { shipId: fleet.far.shipId })).resolves.toMatchObject(NOT_REACHABLE);
    expect(actorsOf('LeaseRevoked')).toEqual([]);
  });
});
